"use client";

import { useState } from "react";
import { Loader2, Fingerprint } from "lucide-react";

export function SyncPersonasButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ hcpsUpdated: number; accountsUpdated: number } | { error: string } | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    const res = await fetch("/api/sync-personas", { method: "POST" });
    setResult(await res.json());
    setLoading(false);
  }

  return (
    <div>
      <button
        onClick={run}
        disabled={loading}
        className="flex items-center gap-2 rounded-lg border border-primary-100 bg-primary-50 px-4 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-50"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />}
        Synchroniser les personas (Nexora)
      </button>
      {result && (
        <p className={`mt-3 text-sm ${"error" in result ? "text-danger" : "text-muted-foreground"}`}>
          {"error" in result
            ? result.error
            : `${result.hcpsUpdated} médecin(s) et ${result.accountsUpdated} compte(s) mis à jour.`}
        </p>
      )}
    </div>
  );
}
