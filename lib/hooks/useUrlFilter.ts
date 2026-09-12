"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Filtre porté par l'URL (`?segment=A&tier=Pro…`).
 *
 * Pourquoi l'URL : les trois onglets de Comptes (liste, carte, produits)
 * avaient chacun leurs filtres, perdus à chaque changement d'onglet. Portés
 * par l'URL, ils survivent au changement de vue, se partagent d'un lien et
 * reviennent avec le bouton « précédent ».
 *
 * Pourquoi `history.replaceState` et non `router.replace` : la seconde
 * relance le rendu serveur de la page — donc le rechargement de tous les
 * comptes — à chaque frappe dans un champ de recherche. La première met
 * l'URL à jour et Next la répercute dans `useSearchParams` sans aller-retour.
 */
export function useUrlFilter(key: string, fallback = "all"): [string, (value: string) => void] {
  const params = useSearchParams();
  const value = params.get(key) ?? fallback;

  const set = useCallback(
    (next: string) => {
      const url = new URL(window.location.href);
      if (next === fallback || next === "") url.searchParams.delete(key);
      else url.searchParams.set(key, next);
      window.history.replaceState(window.history.state, "", url);
    },
    [key, fallback]
  );

  return [value, set];
}
