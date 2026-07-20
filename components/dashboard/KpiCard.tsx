import { Card, CardContent } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function KpiCard({
  label,
  value,
  icon: Icon,
  trend,
  tone = "default",
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  trend?: string;
  tone?: "default" | "positive" | "negative";
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
          {trend ? (
            <p
              className={cn(
                "mt-1 text-xs font-medium",
                tone === "positive" && "text-success",
                tone === "negative" && "text-danger",
                tone === "default" && "text-muted-foreground"
              )}
            >
              {trend}
            </p>
          ) : null}
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary">
          <Icon size={18} />
        </div>
      </CardContent>
    </Card>
  );
}
