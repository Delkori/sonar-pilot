"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  CalendarClock,
  ChevronsLeft,
  ChevronsRight,
  Fingerprint,
  Gamepad2,
  Grid3x3,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Radar,
  Settings,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Navigation principale.
 *
 * Avant : dix icônes de 19px sans libellé dans un rail de 64px, sans ordre
 * apparent et sans rien sur mobile (le rail restait fixe et rognait déjà un
 * écran étroit). Trouver « Matrice » demandait de survoler les icônes une à
 * une pour lire les `title` — et sur tactile, où le survol n'existe pas,
 * c'était de la devinette pure.
 *
 * Après : libellés visibles, regroupement par intention (piloter / analyser /
 * administrer), état déplié mémorisé d'une visite à l'autre, et un tiroir
 * plein écran sous `lg`.
 */
type NavItem = { href: string; label: string; icon: LucideIcon; hint: string };
type NavGroup = { title: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    title: "Piloter",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, hint: "Vue d'ensemble du secteur" },
      { href: "/pilotage", label: "Pilotage", icon: Gamepad2, hint: "Opportunités et objectifs par mois" },
      { href: "/relances", label: "Planning", icon: CalendarClock, hint: "Semaine de visites et d'appels" },
    ],
  },
  {
    title: "Analyser",
    items: [
      { href: "/comptes", label: "Comptes", icon: Users, hint: "Référentiel et fiches client" },
      { href: "/mapping", label: "Mapping AURA", icon: Map, hint: "Lecture géographique du secteur" },
      { href: "/matrice", label: "Matrice produit", icon: Grid3x3, hint: "Qui achète quoi" },
      { href: "/sonarscore", label: "SonarScore", icon: Activity, hint: "Scoring comportemental (bêta)" },
      { href: "/personas", label: "Personas", icon: Fingerprint, hint: "Profils d'achat par spécialité" },
      { href: "/sponsoring", label: "Sponsoring", icon: HandCoins, hint: "Concurrence et Transparence Santé" },
    ],
  },
  {
    title: "Administrer",
    items: [
      { href: "/parametres", label: "Paramètres", icon: Settings, hint: "Objectifs, import, personas" },
    ],
  },
];

const STORAGE_KEY = "sonar-pilot.sidebar-expanded";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Préférence lue après hydratation : la lire pendant le rendu ferait
  // diverger le HTML serveur du HTML client.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored !== null) setExpanded(stored === "1");
    } catch {
      // localStorage indisponible (navigation privée) — on garde le défaut.
    }
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleExpanded() {
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* préférence non persistée, sans conséquence */
      }
      return next;
    });
  }

  const width = expanded ? "w-60" : "w-16";

  const nav = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-2" aria-label="Navigation principale">
      {GROUPS.map((group) => (
        <div key={group.title}>
          {expanded && (
            <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group.title}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.items.map(({ href, label, icon: Icon, hint }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    title={expanded ? hint : `${label} — ${hint}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      expanded ? "justify-start" : "justify-center",
                      active
                        ? "bg-primary-50 text-primary"
                        : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                    )}
                  >
                    <Icon size={19} className="shrink-0" />
                    {expanded && <span className="truncate">{label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const footer = (
    <form action="/auth/signout" method="post" className="border-t border-border p-2">
      <button
        type="submit"
        title="Se déconnecter"
        className={cn(
          "flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors",
          "hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40",
          expanded ? "justify-start" : "justify-center"
        )}
      >
        <LogOut size={18} className="shrink-0" />
        {expanded && <span>Se déconnecter</span>}
      </button>
    </form>
  );

  const brand = (
    <div className={cn("flex h-14 items-center gap-2.5 border-b border-border px-3", !expanded && "justify-center")}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
        <Radar size={18} />
      </span>
      {expanded && <span className="truncate text-sm font-semibold text-foreground">Sonar Pilot</span>}
    </div>
  );

  return (
    <>
      {/* Barre mobile : le rail fixe n'avait aucune alternative sous lg. */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Ouvrir la navigation"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-surface-muted"
        >
          <Menu size={18} />
        </button>
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Radar size={16} className="text-primary" /> Sonar Pilot
        </span>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fermer la navigation"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-foreground/30"
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-surface shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-border px-3">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Radar size={16} className="text-primary" /> Sonar Pilot
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Fermer"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-muted"
              >
                <X size={18} />
              </button>
            </div>
            {/* Le tiroir mobile est toujours déplié : masquer les libellés sur
                tactile reproduirait exactement le problème qu'on corrige. */}
            <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-2" aria-label="Navigation principale">
              {GROUPS.map((group) => (
                <div key={group.title}>
                  <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {group.title}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map(({ href, label, icon: Icon }) => {
                      const active = isActive(pathname, href);
                      return (
                        <li key={href}>
                          <Link
                            href={href}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm font-medium",
                              active
                                ? "bg-primary-50 text-primary"
                                : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                            )}
                          >
                            <Icon size={19} className="shrink-0" />
                            <span className="truncate">{label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
            <form action="/auth/signout" method="post" className="border-t border-border p-2">
              <button
                type="submit"
                className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-muted-foreground hover:bg-danger/10 hover:text-danger"
              >
                <LogOut size={18} /> Se déconnecter
              </button>
            </form>
          </aside>
        </div>
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex",
          width
        )}
      >
        {brand}
        {nav}
        <button
          type="button"
          onClick={toggleExpanded}
          aria-label={expanded ? "Réduire la navigation" : "Déplier la navigation"}
          className={cn(
            "flex h-9 items-center gap-3 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
            !expanded && "justify-center"
          )}
        >
          {expanded ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
          {expanded && <span>Réduire</span>}
        </button>
        {footer}
      </aside>

      {/* Décale le contenu de la largeur exacte du rail. */}
      <div className={cn("hidden transition-[width] duration-200 lg:block", width)} aria-hidden />
    </>
  );
}
