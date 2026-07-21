"use client";

import { useState } from "react";
import { UploadCloud, CheckCircle2, AlertCircle, Loader2, ChevronDown, Trash2 } from "lucide-react";

interface ImportResult {
  importId?: string;
  rowsTotal: number;
  rowsSuccess: number;
  rowsError: number;
  errors: { row: number; message: string }[];
  status: "success" | "partial" | "failed";
}

const PRIMARY_FIELDS = [
  {
    key: "salesforce",
    required: true,
    title: "Rapport Salesforce",
    description: 'Export "Rapport Salesforce.xls" — référentiel compte : nom, segment, potentiel, adresse, code postal, ville, email, téléphone.',
  },
  {
    key: "accountDetail",
    required: false,
    title: "Account Detail (factures)",
    description: '"ACCOUNT DETAIL.xlsx" — une facture par ligne : alimente le CA réel par année, la date de dernière commande et le silence.',
  },
  {
    key: "invoiceProducts",
    required: false,
    title: "Invoice Number et Product",
    description: '"INVOICE NUMBER ET PRODUCT.xlsx" — le détail produit de chaque facture (nécessite Account Detail pour retrouver le compte) : ventes mensuelles réelles et données produit.',
  },
] as const;

const LEGACY_FIELDS = [
  {
    key: "pas",
    title: "Fichier PAS",
    description: 'Si vous y avez encore accès : "PAS ... RHONE ALPES.xlsx" — remplace le Rapport Salesforce comme référentiel compte.',
  },
  {
    key: "kpi",
    title: "Fichier KPI",
    description: '"KPI RHONE ALPES ....xlsx" — complète ville, code postal, statut et commercial.',
  },
  {
    key: "monthly",
    title: "Ventes mensuelles (ancien format)",
    description: '"Products Purchased By Customers...xlsx".',
  },
  {
    key: "calls",
    title: "Appels",
    description: '"Calls By Customer.xlsx" — date du dernier appel.',
  },
  {
    key: "growth",
    title: "Croissance par marque (ancien format)",
    description: '"Customer Growth By Brand...xlsx".',
  },
] as const;

type FileKey = (typeof PRIMARY_FIELDS)[number]["key"] | (typeof LEGACY_FIELDS)[number]["key"];

export function ImportForm() {
  const [files, setFiles] = useState<Record<FileKey, File | null>>({
    salesforce: null,
    accountDetail: null,
    invoiceProducts: null,
    pas: null,
    kpi: null,
    monthly: null,
    calls: null,
    growth: null,
  });
  const [showLegacy, setShowLegacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | { error: string } | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeResult, setGeocodeResult] = useState<{ geocoded: number; failed: number } | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ cleaned: number } | null>(null);

  const canImport = Boolean(files.pas || files.salesforce);

  async function handleImport() {
    if (!canImport) return;
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

  async function handleCleanupPas() {
    const confirmed = window.confirm(
      "Ceci efface définitivement CA 2022/2023, l'action recommandée et les références manquantes issues de l'ancien PAS sur tous les comptes (données non remplacées par une autre source). Confirmer ?"
    );
    if (!confirmed) return;
    setCleaning(true);
    const res = await fetch("/api/cleanup-pas", { method: "POST" });
    const json = await res.json();
    setCleanupResult(json);
    setCleaning(false);
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
          Le <strong>Rapport Salesforce</strong> est le référentiel compte principal — Account Detail et Invoice Number
          et Product sont facultatifs mais recommandés pour un CA et un score de ciblage à jour.
        </p>
        <div className="space-y-4">
          {PRIMARY_FIELDS.map((field) => (
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
          onClick={() => setShowLegacy((v) => !v)}
          className="mt-5 flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown size={13} className={showLegacy ? "rotate-180 transition-transform" : "transition-transform"} />
          Fichiers PAS (si vous y avez encore accès)
        </button>

        {showLegacy && (
          <div className="mt-4 space-y-4 border-t border-border pt-4">
            {LEGACY_FIELDS.map((field) => (
              <div key={field.key}>
                <h3 className="mb-1 text-sm font-semibold text-foreground">{field.title}</h3>
                <p className="mb-2 text-xs text-muted-foreground">{field.description}</p>
                <FileInput
                  file={files[field.key]}
                  onChange={(f) => setFiles((prev) => ({ ...prev, [field.key]: f }))}
                />
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleImport}
          disabled={!canImport || loading}
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

      <div className="rounded-xl border border-danger/30 bg-surface p-6">
        <h3 className="mb-1 text-sm font-semibold text-foreground">Nettoyer les anciennes données PAS</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          Efface CA 2022/2023, l&apos;action recommandée et les références manquantes issues du PAS — ces champs ne sont
          plus alimentés par le nouveau pipeline et faussent le dashboard s&apos;ils restent figés. Le score de ciblage
          n&apos;est pas affecté, il est recalculé en direct.
        </p>
        <button
          onClick={handleCleanupPas}
          disabled={cleaning}
          className="flex items-center gap-2 rounded-lg border border-danger/40 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/5 disabled:opacity-50"
        >
          {cleaning ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          Nettoyer les données PAS
        </button>
        {cleanupResult && (
          <p className="mt-3 text-sm text-muted-foreground">{cleanupResult.cleaned} compte(s) nettoyé(s).</p>
        )}
      </div>

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
      {file ? file.name : "Choisir un fichier .xlsx / .xls"}
      <input
        type="file"
        accept=".xlsx,.xls"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        onChange={(e) => {
          const selected = e.target.files?.[0] ?? null;
          onChange(selected);
        }}
      />
    </label>
  );
}
