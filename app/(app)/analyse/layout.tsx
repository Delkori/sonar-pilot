import { PageShell } from "@/components/layout/PageShell";
import { HubTabs } from "@/components/layout/HubTabs";

/**
 * Hub Analyse : ce que les données disent du portefeuille. Quatre anciens
 * écrans réunis — chacun reste une route qui charge ses seules données.
 */
export default function AnalyseLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageShell
      title="Analyse"
      subtitle="Ce que les données disent du portefeuille : chances de commande, scoring, profils, concurrence"
      tabs={
        <HubTabs
          items={[
            { href: "/analyse", label: "Probabilités", exact: true, hint: "Chances de commande par compte et par critère" },
            { href: "/analyse/sonarscore", label: "SonarScore", hint: "Scoring comportemental RFM-S (bêta)" },
            { href: "/analyse/personas", label: "Personas", hint: "Profils d'achat par spécialité" },
            { href: "/analyse/concurrence", label: "Concurrence", hint: "Sponsoring et Transparence Santé" },
          ]}
        />
      }
    >
      {children}
    </PageShell>
  );
}
