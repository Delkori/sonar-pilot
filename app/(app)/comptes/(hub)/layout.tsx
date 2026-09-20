import { PageShell } from "@/components/layout/PageShell";
import { Suspense } from "react";
import { HubTabs } from "@/components/layout/HubTabs";

/**
 * Hub Comptes : le référentiel du secteur sous quatre angles — la liste, la
 * carte, les produits (qui achète quoi, personas) et les prospects à
 * conquérir. Le groupe de routes `(hub)` isole ce gabarit de la fiche
 * `comptes/[id]`, qui garde le sien.
 */
export default function ComptesHubLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageShell
      title="Comptes"
      subtitle="Le référentiel du secteur — en liste, sur la carte, par produit, et les prospects à conquérir"
      tabs={
        <Suspense>
        <HubTabs
          items={[
            { href: "/comptes", label: "Liste", exact: true, hint: "Tous les comptes, filtres et score de ciblage" },
            { href: "/comptes/carte", label: "Carte", hint: "Lecture géographique et préparation de tournée" },
            { href: "/comptes/produits", label: "Produits", hint: "Qui a acheté quoi, personas et cross-sell" },
            { href: "/comptes/prospects", label: "Prospects", hint: "Médecins sponsorisés absents de votre Salesforce (Transparence Santé)" },
          ]}
        />
        </Suspense>
      }
    >
      {children}
    </PageShell>
  );
}
