"use client";

import { useState } from "react";
import { UploadCloud, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface ImportResult {
  importId?: string;
  rowsTotal: number;
  rowsSuccess: number;
  rowsError: number;
  errors: { row: number; message: string }[];
  status: "success" | "partial" | "failed";
}

export function ImportForm() {
  const [pasFile, setPasFile] = useState<File | null>(null);
  const [kpiFile, setKpiFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | { error: string } | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeResult, setGeocodeResult] = useState<{ geocoded: number; failed: number } | null>(null);

  async function handleImport() {
    if (!pasFile) return;
    setLoading(true);
    setResult(null);
    const formData = new FormData();
    formData.append("pas", pasFile);
    if (kpiFile) formData.append("kpi", kpiFile);

    const res = await fetch("/api/import", { method: "POST", body: formData });
    const json = await res.json();
    setResult(json);
    setLoading(false);
  }

  async function handleGeocode() {
    setGeocoding(true);
    const res = await fetch("/api/geocode", { method: "POST" });
    const json = await res.json();
    setGeocodeResult(json);
    setGeocoding(false);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-6">
        <h3 className="mb-1 text-sm font-semibold text-foreground">1. Fichier PAS (obligatoire)</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          Le fichier &quot;PAS Q3 2026 - RHONE ALPES.xlsx&quot; — onglet SUIVI COMPTES lu automatiquement.
        </p>
        <FileInput file={pasFile} onChange={setPasFile} />

        <h3 className="mt-6 mb-1 text-sm font-semibold text-foreground">2. Fichier KPI (optionnel)</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          &quot;KPI RHONE ALPES ....xlsx&quot; — complète ville, code postal, statut et commercial.
        </p>
        <FileInput file={kpiFile} onChange={setKpiFile} />

        <button
          onClick={handleImport}
          disabled={!pasFile || loading}
          className="mt-6 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
          Lancer l&apos;import
        </button>
      </div>

      {result && (
        <div className="rounded-xl border border-border bg-surface p-6">
          {"error" in result ? (
            <div className="flex items-center gap-2 text-danger">
              <AlertCircle size={18} />
              <p className="text-sm font-medium">{result.error}</p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-2">
                {result.status === "success" ? (
                  <CheckCircle2 size={18} className="text-success" />
                ) : (
                  <AlertCircle size={18} className="text-warning" />
                )}
                <p className="text-sm font-semibold text-foreground">
                  {result.rowsSuccess} / {result.rowsTotal} lignes importées avec succès
                </p>
              </div>
              {result.errors.length > 0 && (
                <div className="max-h-64 overflow-y-auto rounded-lg bg-surface-muted p-3 text-xs">
                  {result.errors.map((e, i) => (
                    <p key={i} className="py-0.5 text-muted-foreground">
                      Ligne {e.row} — {e.message}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface p-6">
        <h3 className="mb-1 text-sm font-semibold text-foreground">3. Géocodage (carte Mapping)</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          Convertit ville + code postal en latitude/longitude pour les comptes qui n&apos;en ont pas encore, stocke le résultat en base.
        </p>
        <button
          onClick={handleGeocode}
          disabled={geocoding}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-50"
        >
          {geocoding ? <Loader2 size={16} className="animate-spin" /> : null}
          Lancer le géocodage
        </button>
        {geocodeResult && (
          <p className="mt-3 text-sm text-muted-foreground">
            {geocodeResult.geocoded} compte(s) géocodé(s), {geocodeResult.failed} échec(s).
          </p>
        )}
      </div>
    </div>
  );
}

function FileInput({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-primary">
      <UploadCloud size={16} />
      {file ? file.name : "Choisir un fichier .xlsx"}
      <input
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}
