"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface HubTab {
  href: string;
  label: string;
  hint?: string;
  /** Actif seulement sur ce chemin exact (racine du hub). */
  exact?: boolean;
}

/**
 * Onglets d'un hub. Chaque onglet est une route à part entière : l'URL
 * reste partageable, le bouton « précédent » fonctionne, et une page ne
 * charge que ses propres données.
 */
export function HubTabs({ items }: { items: HubTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className="-mx-1 -mb-px flex gap-1 overflow-x-auto">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.hint}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
