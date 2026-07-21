"use client";

import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatEUR, formatPct } from "@/lib/utils";
import type { AccountProduct } from "@/types/database";

type SortKey = "brand" | "ly" | "cy" | "growth";

export function ProductsTable({ products }: { products: AccountProduct[] }) {
  const { sorted, sortKey, dir, toggle } = useSortableTable<AccountProduct, SortKey>(
    products,
    {
      brand: (p) => p.brand,
      ly: (p) => p.sales_value_ly,
      cy: (p) => p.sales_value_cy,
      growth: (p) => p.growth_rate_pct,
    },
    "cy"
  );

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
          <SortableTh label="Marque" sortKey="brand" activeKey={sortKey} dir={dir} onSort={toggle} className="px-0" />
          <SortableTh label="CA N-1" sortKey="ly" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="px-0" />
          <SortableTh label="CA N" sortKey="cy" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="px-0" />
          <SortableTh label="Croissance" sortKey="growth" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="px-0" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <tr key={p.id} className="border-b border-border last:border-0">
            <td className="py-2">{p.brand}</td>
            <td className="py-2 text-right text-muted-foreground">{formatEUR(p.sales_value_ly)}</td>
            <td className="py-2 text-right">{formatEUR(p.sales_value_cy)}</td>
            <td className="py-2 text-right">{formatPct(p.growth_rate_pct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
