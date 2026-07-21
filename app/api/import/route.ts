import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
} from "@/lib/import/salesforceParser";
import { validateKpiRows, validatePasRows } from "@/lib/import/validator";
import type { ImportLogEntry } from "@/lib/import/validator";

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
  const importedBy = (formData.get("importedBy") as string) || null;

  if (!pasFile && !salesforceFile) {
    return NextResponse.json(
      { error: "Un référentiel compte est requis : fichier PAS ou Rapport Salesforce." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const allErrors: ImportLogEntry[] = [];
  let rowsTotal = 0;
  let rowsSuccess = 0;
  const mainFilename = pasFile?.name ?? salesforceFile!.name;

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

    if (salesforceFile) {
      const sfBuffer = await salesforceFile.arrayBuffer();
      const rawSfRows = parseSalesforceReport(sfBuffer);
      rowsTotal += rawSfRows.length;

      for (const row of rawSfRows) {
        if (!row.name) continue;
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
        source: pasFile ? "PAS" : "SALESFORCE",
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

    // upsert accounts by external_ref
    const accountsPayload = Array.from(accountsByRef.values()).map(({ _comment, ...acc }) => ({
      ...acc,
      import_id: importRow.id,
    }));

    const { data: upserted, error: upsertError } = await supabase
      .from("accounts")
      .upsert(accountsPayload, { onConflict: "external_ref" })
      .select("id, external_ref, name");

    if (upsertError) {
      throw new Error(upsertError.message);
    }
    rowsSuccess = upserted?.length ?? 0;

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

    // ACCOUNT DETAIL — factures réelles : CA par an, dates de commande, silence
    let invoiceToCustomer = new Map<string, string>(); // invoiceNumber -> customerName normalisé
    if (accountDetailFile) {
      const buf = await accountDetailFile.arrayBuffer();
      const invoices = parseAccountDetail(buf);
      rowsTotal += invoices.length;
      invoiceToCustomer = new Map(invoices.map((i) => [i.invoiceNumber, normalizeName(i.customerName)]));

      const byAccount = new Map<
        string,
        { ca: Record<number, number>; first: string; last: string; matched: boolean }
      >();
      let invoiceMatched = 0;
      for (const inv of invoices) {
        const key = normalizeName(inv.customerName);
        const accountId = idByName.get(key);
        if (!accountId) {
          allErrors.push({ row: 0, message: `Compte "${inv.customerName}" introuvable — facture ignorée` });
          continue;
        }
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

      if (invoiceToCustomer.size === 0) {
        allErrors.push({
          row: 0,
          message: "Fichier ACCOUNT DETAIL requis pour attribuer les lignes produit à un compte — ignoré",
        });
      } else {
        const productTotals = new Map<string, { qty: number; value: number }>(); // accountId|brand
        const boitesByAccount = new Map<string, number>();
        let linesMatched = 0;

        for (const line of lines) {
          const customerKey = invoiceToCustomer.get(line.invoiceNumber);
          const accountId = customerKey ? idByName.get(customerKey) : undefined;
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
      status: finalStatus,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur d'import inconnue.";
    await supabase.from("imports").insert({
      filename: mainFilename,
      source: pasFile ? "PAS" : "SALESFORCE",
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
