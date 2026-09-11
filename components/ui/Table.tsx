import { cn } from "@/lib/utils";

/**
 * Habillage de tableau. Les mêmes classes d'en-tête étaient recopiées dans
 * 14 tableaux (« border-b border-border text-left text-xs uppercase
 * tracking-wide text-muted-foreground »), sans `scope` sur les `<th>` ni
 * `overflow-x` sur le conteneur — les tableaux larges débordaient donc la
 * page sur mobile au lieu de défiler.
 */
export function TableWrap({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("w-full overflow-x-auto", className)}>{children}</div>;
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full min-w-max text-sm", className)} {...props} />;
}

export function Thead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn("px-3 py-3 font-medium", className)} {...props} />;
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2.5", className)} {...props} />;
}

/** Ligne de tableau avec le survol standard. */
export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("border-b border-border/60 last:border-0 hover:bg-surface-muted/60", className)} {...props} />
  );
}

/** État vide homogène — chaque tableau avait jusqu'ici sa propre formulation. */
export function EmptyState({ children, colSpan }: { children: React.ReactNode; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
