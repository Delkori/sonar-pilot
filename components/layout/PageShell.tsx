import { TopBar } from "@/components/layout/TopBar";
import { cn } from "@/lib/utils";

/**
 * Gabarit de page : barre de titre + zone de contenu.
 *
 * Les 11 pages répétaient le même `<div><TopBar …/><main className="px-8
 * py-6">…</main></div>`, avec des marges qui avaient déjà divergé (une page
 * sans `main`, deux avec des espacements différents). Centraliser le
 * gabarit garantit un rythme vertical identique partout et rend un
 * changement de gouttière global au lieu d'être à répéter onze fois.
 */
export function PageShell({
  title,
  subtitle,
  actions,
  children,
  contentClassName,
  /** Pour les vues plein écran (calendrier, carte) qui gèrent leur propre padding. */
  bare = false,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
  bare?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar title={title} subtitle={subtitle} actions={actions} />
      {bare ? (
        children
      ) : (
        <main className={cn("flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8", contentClassName)}>{children}</main>
      )}
    </div>
  );
}
