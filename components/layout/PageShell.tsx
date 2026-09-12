import { TopBar } from "@/components/layout/TopBar";
import { cn } from "@/lib/utils";

/**
 * Zone de contenu standard (gouttières, rythme vertical). Utilisée par
 * `PageShell`, et directement par les onglets d'un hub dont la mise en page
 * est déclarée `bare` (chaque onglet décide alors de ses marges : le
 * calendrier hebdomadaire n'en veut pas, le prévisionnel mensuel oui).
 */
export function PageContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <main className={cn("flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8", className)}>{children}</main>;
}

/**
 * Gabarit de page : barre de titre (+ onglets éventuels) + zone de contenu.
 *
 * Les pages répétaient le même `<div><TopBar …/><main className="px-8
 * py-6">…</main></div>`, avec des marges qui avaient déjà divergé.
 * Centraliser le gabarit garantit un rythme vertical identique partout.
 *
 * `tabs` sert aux hubs (Planning, Comptes, Analyse) : les sous-pages sont
 * de vraies routes — chacune charge ses seules données — et le gabarit est
 * porté par le `layout.tsx` du hub, avec les onglets sous le titre.
 */
export function PageShell({
  title,
  subtitle,
  actions,
  tabs,
  children,
  contentClassName,
  /** Pour les vues plein écran (calendrier, carte) qui gèrent leur propre padding. */
  bare = false,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  tabs?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
  bare?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar title={title} subtitle={subtitle} actions={actions} tabs={tabs} />
      {bare ? children : <PageContent className={contentClassName}>{children}</PageContent>}
    </div>
  );
}
