"use client";

import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";

/**
 * Tri générique par colonne pour un tableau de lignes. `getters` mappe
 * chaque clé de tri vers une fonction qui extrait la valeur comparable
 * (nombre, string ou null) de la ligne — null est toujours relégué en fin
 * de liste quel que soit le sens du tri.
 */
export function useSortableTable<T, K extends string>(
  rows: T[],
  getters: Record<K, (row: T) => number | string | null>,
  initialKey: K,
  initialDir: SortDir = "desc"
) {
  const [sortKey, setSortKey] = useState<K>(initialKey);
  const [dir, setDir] = useState<SortDir>(initialDir);

  const sorted = useMemo(() => {
    const getter = getters[sortKey];
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb);
      return (va as number) - (vb as number);
    });
    if (dir === "desc") copy.reverse();
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, dir]);

  function toggle(key: K) {
    if (key === sortKey) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDir("desc");
    }
  }

  return { sorted, sortKey, dir, toggle };
}
