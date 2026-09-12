"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { SegmentBadge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import type { AccountStatus, Segment } from "@/types/database";

interface Result {
  id: string;
  name: string;
  city: string | null;
  postal_code: string | null;
  segment: Segment | null;
  status: AccountStatus;
}

/**
 * Recherche globale de compte : quelques lettres, ↑ ↓ Entrée, et la fiche
 * s'ouvre. Atteindre un compte précis demandait jusqu'ici Comptes → filtre
 * → clic — pour le geste le plus fréquent de la journée.
 *
 * `focusToken` : incrémenté par le parent pour donner le focus (raccourci
 * clavier, clic sur l'icône de la barre repliée).
 */
export function AccountSearch({ focusToken = 0, className }: { focusToken?: number; className?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (focusToken > 0) inputRef.current?.focus();
  }, [focusToken]);

  // Interrogation différée de 180 ms et annulation de la requête précédente :
  // taper « martin » ne doit pas déclencher six recherches ni afficher une
  // réponse périmée arrivée après la suivante.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/accounts/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const json = (await res.json()) as { results?: Result[] };
        setResults(json.results ?? []);
        setActive(0);
        setOpen(true);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function go(result: Result) {
    setOpen(false);
    setQuery("");
    setResults([]);
    router.push(`/comptes/${result.id}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  }

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          id="account-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder="Trouver un compte…  ⌘K"
          aria-label="Rechercher un compte"
          role="combobox"
          aria-expanded={open}
          aria-controls="account-search-results"
          aria-autocomplete="list"
          autoComplete="off"
          className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        />
        {loading && <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>

      {open && query.trim().length >= 2 && (
        <ul
          id="account-search-results"
          role="listbox"
          className="absolute left-0 right-0 z-40 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          {results.length === 0 && !loading && (
            <li className="px-3 py-2 text-sm text-muted-foreground">Aucun compte ne correspond.</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm",
                i === active ? "bg-primary-50 text-primary-700" : "text-foreground"
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[r.city, r.postal_code].filter(Boolean).join(" ") || "Ville inconnue"}
                  {r.status === "lost" ? " · perdu" : ""}
                </span>
              </span>
              <SegmentBadge segment={r.segment} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
