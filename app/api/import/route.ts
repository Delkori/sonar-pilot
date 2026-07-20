import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseKpiWorkbook, parsePasWorkbook } from "@/lib/import/parser";
import { mapKpiRow, mapPasRow } from "@/lib/import/mapping";
import { validateKpiRows, validatePasRows } from "@/lib/import/validator";
import type { ImportLogEntry } from "@/lib/import/validator";

export const runtime = "nodejs";

/**
 * Import robuste et non destructif :
 * - upsert par external_ref (CODE SAP / Code client), jamais delete+insert
 * - un import raté ou partiel est journalisé dans `imports`, ne bloque pas
 *   les comptes déjà en base
 * - le fichier PAS (SUIVI COMPTES) est la source principale ; le fichier KPI
 *   optionnel vient compléter ville/CP/statut/owner sur les mêmes comptes
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const pasFile = formData.get("pas") as File | null;
  const kpiFile = formData.get("kpi") as File | null;
  const importedBy = (formData.get("importedBy") as string) || null;

  if (!pasFile) {
    return NextResponse.json({ error: "Fichier PAS (SUIVI COMPTES) requis." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const allErrors: ImportLogEntry[] = [];
  let rowsTotal = 0;
  let rowsSuccess = 0;

  try {
    const pasBuffer = await pasFile.arrayBuffer();
    const rawPasRows = parsePasWorkbook(pasBuffer);
    const pasPatches = rawPasRows.map(mapPasRow);
    const { valid: validPas, errors: pasErrors } = validatePasRows(pasPatches);
    allErrors.push(...pasErrors);
    rowsTotal += rawPasRows.length;

    const accountsByRef = new Map<string, Record<string, unknown>>();
    for (const row of validPas) {
      const { _row, _comment, ...patch } = row as typeof row & { _comment?: string | null };
      accountsByRef.set(patch.external_ref!, { ...patch, _comment });
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
          Object.assign(existing, patch, {
            // ne pas laisser un statut KPI vide écraser un statut déjà connu
            status: patch.status ?? existing.status,
          });
        } else {
          accountsByRef.set(patch.external_ref!, patch);
        }
      }
    }

    // 1) create the import row first so accounts can reference it
    const { data: importRow, error: importInsertError } = await supabase
      .from("imports")
      .insert({
        filename: pasFile.name,
        source: "PAS",
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

    // 2) upsert accounts by external_ref
    const accountsPayload = Array.from(accountsByRef.values()).map(({ _comment, ...acc }) => ({
      ...acc,
      import_id: importRow.id,
    }));

    const { data: upserted, error: upsertError } = await supabase
      .from("accounts")
      .upsert(accountsPayload, { onConflict: "external_ref" })
      .select("id, external_ref");

    if (upsertError) {
      throw new Error(upsertError.message);
    }
    rowsSuccess = upserted?.length ?? 0;

    // 3) push PAS comments into account_actions (avoid duplicating identical comments)
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

    if (comments.length > 0) {
      await supabase.from("account_actions").insert(comments);
    }

    // 4) finalize import log
    const finalStatus = allErrors.length === 0 ? "success" : rowsSuccess > 0 ? "partial" : "failed";
    await supabase
      .from("imports")
      .update({ rows_success: rowsSuccess, status: finalStatus })
      .eq("id", importRow.id);

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
      filename: pasFile.name,
      source: "PAS",
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
