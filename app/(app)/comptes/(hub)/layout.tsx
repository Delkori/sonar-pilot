import { PageShell } from "@/components/layout/PageShell";
import { HubTabs } from "@/components/layout/HubTabs";

/**
 * Hub Comptes : trois lectures du même référentiel — la liste, la carte du
 * secteur, la matrice produit. Le groupe de routes `(hub)` isole ce gabarit
 * de la fiche `comptes/[id]`, qui garde le sien.
 */
export default function ComptesHubLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageShell
      title="Comptes"
      subtitle="Le référentiel du secteur — en liste, sur la carte, par produit"
      tabs={
        <HubTabs
          items={[
            { href: "/comptes", label: "Liste", exact: true, hint: "Tous les comptes, filtres et score de ciblage" },
            { href: "/comptes/carte", label: "Carte", hint: "Lecture géographique et préparation de tournée" },
            { href: "/comptes/produits", label: "Produits", hint: "Qui a acheté quoi — cross-sell" },
          ]}
        />
      }
    >
      {children}
    </PageShell>
  );
}
