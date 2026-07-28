"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function CalendarSubscribeCard({ feedUrl }: { feedUrl: string }) {
  const [copied, setCopied] = useState(false);
  const webcalUrl = feedUrl.replace(/^https?:\/\//, "webcal://");

  function copy() {
    navigator.clipboard.writeText(feedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h3 className="mb-1 text-sm font-semibold text-foreground">Abonnement iPhone / Apple Calendar</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Les actions à échéance, le prévisionnel et le planning hebdomadaire (visites, appels, administratif)
        s&apos;ajoutent automatiquement à votre agenda, mis à jour toutes les 6h par iOS.
      </p>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        <li>Copiez le lien ci-dessous</li>
        <li>iPhone : Réglages → Calendrier → Comptes → Ajouter un compte → Autre → Ajouter un abonnement</li>
        <li>Collez le lien, validez</li>
      </ol>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={feedUrl}
          onFocus={(e) => e.target.select()}
          className="flex-1 truncate rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground"
        />
        <button
          onClick={copy}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary-600"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copié" : "Copier"}
        </button>
      </div>
      <a href={webcalUrl} className="mt-2 inline-block text-xs text-primary hover:underline">
        Ou ouvrir directement sur iPhone (webcal://)
      </a>
    </div>
  );
}
