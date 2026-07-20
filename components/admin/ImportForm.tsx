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

const FILE_FIELDS = [
  {
    key: "pas",
    required: true,
    title: "Fichier PAS",
    description: 'Le fichier "PAS Q3 2026 - RHONE ALPES.xlsx" — onglets SUIVI COMPTES et DATA KPI 2026 lus automatiquement (segments, CA, objectifs, dates de commande).',
  },
  {
    key: "kpi",
    required: false,
    title: "Fichier KPI",
    description: '"KPI RHONE ALPES ....xlsx" — complète ville, code postal, statut et commercial.',
  },
  {
    key: "monthly",
    required: false,
    title: "Ventes mensuelles",
    description: '"Products Purchased By Customers...xlsx" — seul fichier avec un vrai détail mois par mois, alimente le sélecteur année/mois du Dashboard.',
  },
  {
    key: "calls",
    required: false,
    title: "Appels",
    description: '"Calls By Customer.xlsx" — date du dernier appel et nombre de jours depuis, pour repérer les comptes à relancer.',
  },
  {
    key: "growth",
    required: false,
    title: "Croissance par marque",
    description: '"Customer Growth By Brand...xlsx" — CA et quantités par marque, LY vs CY, alimente la fiche compte et le classement produit.',
  },
] as const;

type FileKey = (typeof FILE_FIELDS)[number]["key"];

export function ImportForm() {
  const [files, setFiles] = useState<Record<FileKey, File | null>>({
    pas: null,
    kpi: null,
    monthly: null,
    calls: null,
    growth: null,
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | { error: string } | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeResult, setGeocodeResult] = useState<{ geocoded: number; failed: number } | null>(null);

  async function handleImport() {
    if (!files.pas) return;
    setLoading(true);
    setResult(null);
    const formData = new FormData();
    for (const [key, file] of Object.entries(files)) {
      if (file) formData.append(key, file);
    }

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
        <p className="mb-4 text-xs text-muted-foreground">
          Seul le fichier <strong>PAS</strong> est obligatoire — les autres sont facultatifs et viennent simplement enrichir les mêmes comptes.
        </p>
        <div className="space-y-4">
          {FILE_FIELDS.map((field) => (
            <div key={field.key}>
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{field.title}</h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                    field.required ? "bg-primary-100 text-primary-700" : "bg-surface-muted text-muted-foreground"
                  }`}
                >
                  {field.required ? "Obligatoire" : "Optionnel"}
                </span>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">{field.description}</p>
              <FileInput
                file={files[field.key]}
                onChange={(f) => setFiles((prev) => ({ ...prev, [field.key]: f }))}
              />
            </div>
          ))}
        </div>

        <button
          onClick={handleImport}
          disabled={!files.pas || loading}
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
        <h3 className="mb-1 text-sm font-semibold text-foreground">Géocodage (carte Mapping)</h3>
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
    <label className="relative flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-primary">
      <UploadCloud size={16} />
      {file ? file.name : "Choisir un fichier .xlsx"}
      <input
        type="file"
        accept=".xlsx"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        onChange={(e) => {
          const selected = e.target.files?.[0] ?? null;
          onChange(selected);
        }}
      />
    </label>
  );
}
