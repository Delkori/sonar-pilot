import { cn } from "@/lib/utils";

export function TopBar({
  title,
  subtitle,
  actions,
  tabs,
}: {
  title: string;
  subtitle?: string;
  /** Contrôles alignés à droite du titre (boutons, sélecteurs de période…). */
  actions?: React.ReactNode;
  /** Onglets d'un hub, rendus sous le titre et collés avec lui. */
  tabs?: React.ReactNode;
}) {
  return (
    // `top-14` sous lg : la barre de navigation mobile occupe déjà le
    // haut de l'écran — collées toutes deux à 0, elles se superposaient.
    <header
      className={cn(
        "sticky top-14 z-10 border-b border-border bg-surface/80 px-4 backdrop-blur sm:px-6 lg:top-0 lg:px-8",
        tabs ? "pt-4 lg:pt-5" : "py-4 lg:py-5"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-foreground lg:text-xl">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {tabs ? <div className="mt-3">{tabs}</div> : null}
    </header>
  );
}
