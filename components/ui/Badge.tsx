import { cn } from "@/lib/utils";
import type { AccountStatus, Segment } from "@/types/database";

const segmentStyles: Record<Segment, string> = {
  A: "bg-primary-100 text-primary-700",
  B: "bg-indigo-50 text-indigo-600 border border-indigo-200",
  C: "bg-slate-100 text-slate-700",
  D: "bg-amber-50 text-amber-700",
  E: "bg-rose-50 text-rose-700",
};

export function SegmentBadge({ segment }: { segment: Segment | null }) {
  if (!segment) {
    return <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-muted-foreground">—</span>;
  }
  return (
    <span className={cn("inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-semibold", segmentStyles[segment])}>
      {segment}
    </span>
  );
}

const statusStyles: Record<AccountStatus, { label: string; className: string }> = {
  actif: { label: "Actif", className: "bg-green-50 text-green-700 border border-green-200" },
  lost: { label: "Lost", className: "bg-rose-50 text-rose-700 border border-rose-200" },
  new: { label: "Nouveau", className: "bg-primary-50 text-primary-700 border border-primary-100" },
  reconnected: { label: "Reconnecté", className: "bg-teal-50 text-teal-700 border border-teal-200" },
  a_risque: { label: "À risque", className: "bg-amber-50 text-amber-700 border border-amber-200" },
  a_suivre: { label: "À suivre", className: "bg-slate-100 text-slate-700 border border-slate-200" },
};

export function StatusBadge({ status }: { status: AccountStatus }) {
  const s = statusStyles[status];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", s.className)}>
      {s.label}
    </span>
  );
}
