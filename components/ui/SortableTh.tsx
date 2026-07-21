"use client";

import { ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";

export function SortableTh<K extends string>({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "left",
  className = "",
}: {
  label: string;
  sortKey: K;
  activeKey: K;
  dir: "asc" | "desc";
  onSort: (key: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sortKey === activeKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none px-3 py-3 font-medium hover:text-foreground ${className}`}
    >
      <span className={`flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        {label}
        {active ? (
          dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
        ) : (
          <ChevronsUpDown size={12} className="opacity-30" />
        )}
      </span>
    </th>
  );
}
