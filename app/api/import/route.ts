import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  parseCallsWorkbook,
  parseGrowthByBrandWorkbook,
  parseKpiDataSheet,
  parseKpiWorkbook,
  parseMonthlySalesWorkbook,
  parsePasWorkbook,
  parseProduitsSheet,
} from "@/lib/import/parser";
import {
  mapCallsRow,
  mapGrowthByBrandRow,
  mapKpiDataRow,
  mapKpiRow,
  mapPasRow,
  departmentCodeFromPostal,
  normalizeName,
} from "@/lib/import/mapping";
import {
  canonicalizeBrand,
  parseAccountDetail,
  parseAccountPartners,
  parseInvoiceProducts,
  parseSalesforceReport,
  parseNexoraSponsorships,
} from "@/lib/import/salesforceParser";
import { validateKpiRows, validatePasRows } from "@/lib/import/validator";
import type { ImportLogEntry } from "@/lib/import/validator";
import { bestMatch, HIGH_CONFIDENCE } from "@/lib/import/nameResolver";
import { statusFromLastOrder } from "@/lib/accounts";
import type { Hcp } from "@/types/database";

export const runtime = "nodejs";

/**
 * Import robuste et non destructif :
 * - upsert par external_ref, jamais delete+insert
 * - un import raté ou partiel est journalisé dans `imports`, ne bloque pas
 *   les comptes déjà en base
 * - deux chemins possibles pour le référentiel compte :
 *   - historique : fichier PAS (SUIVI COMPTES)
 *   - actuel : "Rapport Salesforce" — les comptes sans code SAP reçoivent
 *     un external_ref synthétique stable, dérivé du nom normalisé
 * - ACCOUNT DETAIL (factures) et INVOICE NUMBER ET PRODUCT (lignes produit)
 *   sont optionnels et alimentent CA réel, silence, ventes mensuelles et
 *   données produit — matching par nom de client normalisé
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const pasFile = formData.get("pas") as File | null;
  const salesforceFile = formData.get("salesforce") as File | null;
  const accountDetailFile = formData.get("accountDetail") as File | null;
  const invoiceProductsFile = formData.get("invoiceProducts") as File | null;
  const kpiFile = formData.get("kpi") as File | null;
  const monthlyFile = formData.get("monthly") as File | null;
  const callsFile = formData.get("calls") as File | null;
  const growthFile = formData.get("growth") as File | null;
  const nexoraFile = formData.get("nexora") as File | null;
  const importedBy = (formData.get("importedBy") as string) || null;

  // Salesforce/PAS ne sont plus obligatoires : Account Detail, Invoice
  // Number et Product et KPI peuvent être importés seuls et se rapprochent
  // des comptes déjà en base par nom.
  if (!pasFile && !salesforceFile && !accountDetailFile && !invoiceProductsFile && !kpiFile && !nexoraFile) {
    return NextResponse.json(
      { error: "Sélectionnez au moins un fichier à importer." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const allErrors: ImportLogEntry[] = [];
  let rowsTotal = 0;
  let rowsSuccess = 0;
  const mainFilename =
    pasFile?.name ??
    salesforceFile?.name ??
    accountDetailFile?.name ??
    invoiceProductsFile?.name ??
    kpiFile?.name ??
    nexoraFile?.name ??
    "import";
  const importSource = pasFile ? "PAS" : salesforceFile ? "SALESFORCE" : kpiFile ? "KPI" : "PRODUCTS";

  try {
    const accountsByRef = new Map<string, Record<string, unknown>>();

    if (pasFile) {
      const pasBuffer = await pasFile.arrayBuffer();
      const rawPasRows = parsePasWorkbook(pasBuffer);
      const pasPatches = rawPasRows.map(mapPasRow);
      const { valid: validPas, errors: pasErrors } = validatePasRows(pasPatches);
      allErrors.push(...pasErrors);
      rowsTotal += rawPasRows.length;

      for (const row of validPas) {
        const { _row, _comment, ...patch } = row as typeof row & { _comment?: string | null };
        accountsByRef.set(patch.external_ref!, { ...patch, _comment });
      }

      // DATA KPI 2026 — dates de commande + commercial, déjà dans le PAS
      const kpiDataRows = parseKpiDataSheet(pasBuffer);
      for (const row of kpiDataRows) {
        const { externalRef, patch } = mapKpiDataRow(row);
        const existing = accountsByRef.get(externalRef);
        if (existing) Object.assign(existing, patch, { owner: existing.owner ?? patch.owner });
      }
      rowsTotal += kpiDataRows.length;

      // DATA PRODUITS 2025 — nb de références achetées, pour le score
      const refsBoughtByCode = parseProduitsSheet(pasBuffer);
      for (const [code, count] of refsBoughtByCode) {
        const existing = accountsByRef.get(code);
        if (existing) existing.nb_refs_achetees_2025 = count;
      }
    }

    // Le Rapport Salesforce mélange deux niveaux : les lignes sans "Parent
    // principal" sont des structures (HCO = accounts), celles qui en ont un
    // sont des médecins (HCP) rattachés à cette structure — traités après
    // l'upsert des comptes, une fois le nom de la structure résolvable.
    let rawHcpRows: ReturnType<typeof parseSalesforceReport> = [];

    if (salesforceFile) {
      const sfBuffer = await salesforceFile.arrayBuffer();
      const rawSfRows = parseSalesforceReport(sfBuffer);
      rowsTotal += rawSfRows.length;
      rawHcpRows = rawSfRows.filter((r) => r.parentPrincipal);

      for (const row of rawSfRows) {
        if (!row.name || row.parentPrincipal) continue;
        const externalRef = row.externalRef || `NAME:${normalizeName(row.name)}`;
        const { tier, objectifBoites } = parseAccountPartners(row.accountPartners);
        const patch: Record<string, unknown> = {
          external_ref: externalRef,
          name: row.name,
          segment: (["A", "B", "C", "D", "E"] as const).includes(row.segment as never)
            ? row.segment
            : null,
          potentiel_boites: row.potentielBoites,
          city: row.city,
          postal_code: row.postalCode,
          department_code: departmentCodeFromPostal(row.postalCode),
          email: row.email || row.email2,
          telephone: row.telephone || row.mobile,
          nom_concurrent: row.competitor || null,
        };
        if (tier) patch.price_list = tier;
        if (objectifBoites !== null) patch.objectif_boites = objectifBoites;
        const existing = accountsByRef.get(externalRef);
        if (existing) Object.assign(existing, patch);
        else accountsByRef.set(externalRef, patch);
      }
    }

    if (kpiFile) {
      const kpiBuffer = await kpiFile.arrayBuffer();
      const rawKpiRows = parseKpiWorkbook(kpiBuffer);
      const kpiPatches = rawKpiRows.map(mapKpiRow);
      const { valid: validKpi, errors: kpiErrors } = validateKpiRows(kpiPatches);
      allErrors.push(...kpiErrors);
      rowsTotal += rawKpiRows.length;

      for (const row of validKpi) {
        const { _row, ...patch } = row;
        const existing = accountsByRef.get(patch.external_ref!);
        if (existing) {
          Object.assign(existing, patch, { status: patch.status ?? existing.status });
        } else {
          accountsByRef.set(patch.external_ref!, patch);
        }
      }
    }

    // create the import row first so accounts can reference it
    const { data: importRow, error: importInsertError } = await supabase
      .from("imports")
      .insert({
        filename: mainFilename,
        source: importSource,
        imported_by: importedBy,
        status: "success",
        rows_total: rowsTotal,
        rows_success: 0,
        rows_error: allErrors.length,
        log: allErrors,
      })
      .select()
      .single();

    if (importInsertError || !importRow) {
      throw new Error(importInsertError?.message ?? "Échec de création de l'import.");
    }

    // upsert accounts by external_ref — pas de fichier référentiel (Salesforce/
    // PAS/KPI) dans cet import : rien à upserter, on garde les comptes existants.
    const accountsPayload = Array.from(accountsByRef.values()).map(({ _comment, ...acc }) => ({
      ...acc,
      import_id: importRow.id,
    }));

    let upserted: { id: string; external_ref: string; name: string }[] = [];
    if (accountsPayload.length > 0) {
      const { data, error: upsertError } = await supabase
        .from("accounts")
        .upsert(accountsPayload, { onConflict: "external_ref" })
        .select("id, external_ref, name");
      if (upsertError) {
        throw new Error(upsertError.message);
      }
      upserted = data ?? [];
    }
    rowsSuccess = upserted.length;

    // comments issus du PAS (si présent)
    const refToId = new Map((upserted ?? []).map((a) => [a.external_ref, a.id] as const));
    const comments = Array.from(accountsByRef.entries())
      .filter(([, v]) => v._comment)
      .map(([ref, v]) => ({
        account_id: refToId.get(ref),
        type: "commentaire" as const,
        content: v._comment as string,
        created_by: importedBy,
      }))
      .filter((c) => c.account_id);
    if (comments.length > 0) await supabase.from("account_actions").insert(comments);

    // tous les comptes (post-upsert), nécessaires pour le matching par nom
    // des sources suivantes, qui n'ont pas de code compte stable
    const { data: allAccounts } = await supabase.from("accounts").select("id, name");
    const idByName = new Map((allAccounts ?? []).map((a) => [normalizeName(a.name), a.id] as const));

    // rapprochement flou (ex. "DR BEILLE Laurence" ↔ "CABINET DR BEILLE
    // Laurence") pour les sources dont le nom ne correspond jamais
    // exactement à Salesforce — auto-appliqué à haute confiance, sinon mis
    // en attente de validation dans /admin/correspondances
    const { data: aliasRows } = await supabase.from("name_aliases").select("raw_name, account_id");
    const aliasMap = new Map((aliasRows ?? []).map((a) => [a.raw_name, a.account_id] as const));
    const { data: existingCandidates } = await supabase.from("name_match_candidates").select("raw_name");
    const knownCandidateNames = new Set((existingCandidates ?? []).map((c) => c.raw_name));
    let pendingReviewCount = 0;

    async function resolveAccountId(rawName: string): Promise<string | null> {
      const exact = idByName.get(normalizeName(rawName));
      if (exact) return exact;
      if (aliasMap.has(rawName)) return aliasMap.get(rawName)!;
      if (knownCandidateNames.has(rawName)) return null;

      const match = bestMatch(rawName, allAccounts ?? []);
      if (match && match.score >= HIGH_CONFIDENCE) {
        await supabase
          .from("name_aliases")
          .insert({ raw_name: rawName, account_id: match.accountId, confidence: match.score });
        aliasMap.set(rawName, match.accountId);
        return match.accountId;
      }

      await supabase.from("name_match_candidates").insert({
        raw_name: rawName,
        candidate_account_id: match?.accountId ?? null,
        candidate_name: match?.accountName ?? null,
        confidence: match?.score ?? 0,
      });
      knownCandidateNames.add(rawName);
      pendingReviewCount++;
      return null;
    }

    // Lignes HCP (médecins) du Rapport Salesforce — rattachées à leur
    // structure (HCO) via "Parent principal", résolu par le même moteur de
    // rapprochement flou que les factures.
    if (rawHcpRows.length > 0) {
      rowsTotal += rawHcpRows.length;
      let hcpMatched = 0;
      const hcpPayload: Partial<Hcp>[] = [];
      for (const row of rawHcpRows) {
        const accountId = await resolveAccountId(row.parentPrincipal!);
        if (!accountId) {
          allErrors.push({
            row: 0,
            message: `Structure "${row.parentPrincipal}" en attente de validation — médecin "${row.name}" ignoré pour l'instant`,
          });
          continue;
        }
        hcpMatched++;
        const externalRef = row.rpps || `NAME:${normalizeName(row.name)}`;
        hcpPayload.push({
          external_ref: externalRef,
          account_id: accountId,
          name: row.name,
          rpps: row.rpps || null,
          segment: (["A", "B", "C", "D", "E"] as const).includes(row.segment as never)
            ? (row.segment as Hcp["segment"])
            : null,
          potentiel_boites: row.potentielBoites,
          address: row.address,
          postal_code: row.postalCode,
          city: row.city,
          email: row.email || row.email2,
          telephone: row.telephone || row.mobile,
          nom_concurrent: row.competitor || null,
        });
      }
      // Dédoublonnage par external_ref : un upsert groupé échoue si la même
      // clé apparaît deux fois dans le lot (homonymes sans RPPS). On garde la
      // dernière occurrence.
      const dedupedHcp = Array.from(
        new Map(hcpPayload.map((h) => [h.external_ref, h])).values()
      );
      if (dedupedHcp.length > 0) {
        const { error } = await supabase.from("hcps").upsert(dedupedHcp, { onConflict: "external_ref" });
        if (error) allErrors.push({ row: 0, message: `Médecins (HCP) : ${error.message}` });
      }
      rowsSuccess += hcpMatched;
    }

    if (monthlyFile) {
      const monthlyBuffer = await monthlyFile.arrayBuffer();
      const monthlyRows = parseMonthlySalesWorkbook(monthlyBuffer);
      rowsTotal += monthlyRows.length;
      const monthlyPayload = [];
      let monthlyMatched = 0;
      for (const row of monthlyRows) {
        const accountId = idByName.get(normalizeName(row.customerName));
        if (!accountId) {
          allErrors.push({ row: 0, message: `Compte "${row.customerName}" introuvable — vente mensuelle ignorée` });
          continue;
        }
        monthlyMatched++;
        monthlyPayload.push({ account_id: accountId, year: row.year, month: row.month, ca: row.ca });
      }
      if (monthlyPayload.length > 0) {
        const { error } = await supabase
          .from("account_monthly_sales")
          .upsert(monthlyPayload, { onConflict: "account_id,year,month" });
        if (error) allErrors.push({ row: 0, message: `Ventes mensuelles : ${error.message}` });
      }
      rowsSuccess += monthlyMatched;
    }

    if (callsFile) {
      const callsBuffer = await callsFile.arrayBuffer();
      const rawCallsRows = parseCallsWorkbook(callsBuffer);
      rowsTotal += rawCallsRows.length;
      let callsMatched = 0;
      for (const row of rawCallsRows) {
        const { name, patch } = mapCallsRow(row);
        const accountId = idByName.get(name);
        if (!accountId) {
          allErrors.push({ row: 0, message: `Compte "${patch.name}" introuvable — appel ignoré` });
          continue;
        }
        const { error } = await supabase
          .from("accounts")
          .update({ last_call_date: patch.last_call_date, days_since_last_call: patch.days_since_last_call })
          .eq("id", accountId);
        if (!error) callsMatched++;
      }
      rowsSuccess += callsMatched;
    }

    if (growthFile) {
      const growthBuffer = await growthFile.arrayBuffer();
      const rawGrowthRows = parseGrowthByBrandWorkbook(growthBuffer);
      rowsTotal += rawGrowthRows.length;
      const productsPayload = [];
      let growthMatched = 0;
      for (const row of rawGrowthRows) {
        const { name, product } = mapGrowthByBrandRow(row);
        const accountId = idByName.get(name);
        if (!accountId) {
          allErrors.push({ row: 0, message: `Compte "${row["Customer Name"]}" introuvable — croissance marque ignorée` });
          continue;
        }
        growthMatched++;
        productsPayload.push({ account_id: accountId, ...product });
      }
      if (productsPayload.length > 0) {
        const { error } = await supabase
          .from("account_products")
          .upsert(productsPayload, { onConflict: "account_id,brand,period" });
        if (error) allErrors.push({ row: 0, message: `Croissance par marque : ${error.message}` });
      }
      rowsSuccess += growthMatched;
    }

    // NEXORA — sponsoring des médecins par les laboratoires. Indépendant des
    // comptes : le rattachement se fait ensuite via le RPPS des HCP.
    if (nexoraFile) {
      const nexoraBuffer = await nexoraFile.arrayBuffer();
      const sponsorRows = parseNexoraSponsorships(nexoraBuffer);
      rowsTotal += sponsorRows.length;
      if (sponsorRows.length > 0) {
        const payload = sponsorRows.map((r) => ({
          rpps: r.rpps,
          hcp_name: r.hcpName,
          laboratoire: r.laboratoire,
          montant: r.montant,
          annee: r.annee,
          type: r.type,
          source: "nexora",
        }));
        // On repart d'une table propre à chaque import Nexora (remplacement),
        // pour éviter d'empiler les doublons d'un export à l'autre.
        await supabase.from("hcp_sponsorships").delete().eq("source", "nexora");
        const { error } = await supabase.from("hcp_sponsorships").insert(payload);
        if (error) allErrors.push({ row: 0, message: `Sponsoring Nexora : ${error.message}` });
        else rowsSuccess += sponsorRows.length;
      } else {
        allErrors.push({
          row: 0,
          message:
            "Fichier Nexora : aucune ligne exploitable — vérifiez les colonnes (RPPS ou nom médecin, laboratoire, montant).",
        });
      }
    }

    // ACCOUNT DETAIL — factures réelles : CA par an, dates de commande, silence
    const invoiceToAccountId = new Map<string, string>(); // invoiceNumber -> accountId
    if (accountDetailFile) {
      const buf = await accountDetailFile.arrayBuffer();
      const invoices = parseAccountDetail(buf);
      rowsTotal += invoices.length;

      const byAccount = new Map<
        string,
        { ca: Record<number, number>; first: string; last: string; matched: boolean }
      >();
      let invoiceMatched = 0;
      for (const inv of invoices) {
        const accountId = await resolveAccountId(inv.customerName);
        if (!accountId) {
          allErrors.push({
            row: 0,
            message: `Compte "${inv.customerName}" en attente de validation (rapprochement incertain) — facture ignorée pour l'instant`,
          });
          continue;
        }
        invoiceToAccountId.set(inv.invoiceNumber, accountId);
        invoiceMatched++;
        const year = Number(inv.date.slice(0, 4));
        const cur = byAccount.get(accountId) ?? { ca: {}, first: inv.date, last: inv.date, matched: true };
        cur.ca[year] = (cur.ca[year] ?? 0) + inv.totalExclTax;
        if (inv.date < cur.first) cur.first = inv.date;
        if (inv.date > cur.last) cur.last = inv.date;
        byAccount.set(accountId, cur);

        // ventes mensuelles réelles à partir des factures
        const month = Number(inv.date.slice(5, 7));
        await supabase.from("account_monthly_sales").upsert(
          { account_id: accountId, year, month, ca: inv.totalExclTax },
          { onConflict: "account_id,year,month" }
        );
      }
      rowsSuccess += invoiceMatched;

      const now = Date.now();
      for (const [accountId, agg] of byAccount) {
        const silenceDays = Math.floor((now - new Date(agg.last).getTime()) / 86400000);
        await supabase
          .from("accounts")
          .update({
            ca_2024: agg.ca[2024] ?? null,
            ca_2025: agg.ca[2025] ?? null,
            ca_2026_ytd: agg.ca[2026] ?? null,
            first_order_date: agg.first,
            last_order_date: agg.last,
            jours_silence: silenceDays,
            // Le statut Salesforce brut (colonne libre, souvent absente/mal
            // renseignée) n'est pas fiable — le statut réel est dérivé de la
            // dernière commande facturée, toujours à jour à chaque import.
            status: statusFromLastOrder(agg.last),
          })
          .eq("id", accountId);
      }
    }

    // INVOICE NUMBER ET PRODUCT — lignes produit réelles, jointes via le
    // n° de facture d'ACCOUNT DETAIL pour retrouver le compte
    if (invoiceProductsFile) {
      const buf = await invoiceProductsFile.arrayBuffer();
      const lines = parseInvoiceProducts(buf);
      rowsTotal += lines.length;

      if (invoiceToAccountId.size === 0) {
        allErrors.push({
          row: 0,
          message: "Fichier ACCOUNT DETAIL requis pour attribuer les lignes produit à un compte — ignoré",
        });
      } else {
        const productTotals = new Map<string, { qty: number; value: number }>(); // accountId|brand
        const boitesByAccount = new Map<string, number>();
        let linesMatched = 0;

        for (const line of lines) {
          const accountId = invoiceToAccountId.get(line.invoiceNumber);
          if (!accountId) continue;
          linesMatched++;
          const brand = canonicalizeBrand(line.description);
          const key = `${accountId}|${brand}`;
          const cur = productTotals.get(key) ?? { qty: 0, value: 0 };
          cur.qty += line.qty;
          cur.value += line.valueEur;
          productTotals.set(key, cur);

          if (line.date.startsWith(String(new Date().getFullYear()))) {
            boitesByAccount.set(accountId, (boitesByAccount.get(accountId) ?? 0) + line.qty);
          }
        }
        rowsSuccess += linesMatched;

        const productsPayload = Array.from(productTotals.entries()).map(([key, v]) => {
          const [accountId, brand] = key.split("|");
          return {
            account_id: accountId,
            brand,
            sales_value_cy: v.value,
            qty_ordered_cy: v.qty,
            period: "Factures réelles",
          };
        });
        if (productsPayload.length > 0) {
          const { error } = await supabase
            .from("account_products")
            .upsert(productsPayload, { onConflict: "account_id,brand,period" });
          if (error) allErrors.push({ row: 0, message: `Lignes produit : ${error.message}` });
        }

        for (const [accountId, boites] of boitesByAccount) {
          await supabase.from("accounts").update({ realise_boites: boites }).eq("id", accountId);
        }
      }
    }

    const finalStatus = allErrors.length === 0 ? "success" : rowsSuccess > 0 ? "partial" : "failed";
    await supabase.from("imports").update({ rows_success: rowsSuccess, status: finalStatus }).eq("id", importRow.id);

    return NextResponse.json({
      importId: importRow.id,
      rowsTotal,
      rowsSuccess,
      rowsError: allErrors.length,
      errors: allErrors,
      pendingReviewCount,
      status: finalStatus,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur d'import inconnue.";
    await supabase.from("imports").insert({
      filename: mainFilename,
      source: importSource,
      imported_by: importedBy,
      status: "failed",
      rows_total: rowsTotal,
      rows_success: 0,
      rows_error: allErrors.length + 1,
      log: [...allErrors, { row: 0, message }],
    });
    return NextResponse.json({ error: message, errors: allErrors }, { status: 500 });
  }
}
