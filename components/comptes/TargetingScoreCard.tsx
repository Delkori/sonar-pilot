import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { ACTION_META, computeTargetingScore } from "@/lib/scoring";
import type { Account } from "@/types/database";

export function TargetingScoreCard({ account, refsAcheteesCount }: { account: Account; refsAcheteesCount?: number }) {
  const score = computeTargetingScore(account, { refsAcheteesCount });
  const meta = ACTION_META[score.action];
  const scoreColor = score.total >= 70 ? "#dc2626" : score.total >= 45 ? "#d97706" : "#16a34a";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>Score de ciblage</CardTitle>
          <CardDescription>Recalculé en direct — barème du PAS</CardDescription>
        </div>
        <div className="text-right">
          <span className="text-2xl font-semibold" style={{ color: scoreColor }}>
            {score.total}
          </span>
          <span className="text-sm text-muted-foreground">/100</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {score.criteria.map((c) => (
          <div key={c.key}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-foreground">{c.label}</span>
              <span className="font-medium text-foreground">
                {c.points}
                <span className="text-xs text-muted-foreground">/{c.max}</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-muted">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{ width: `${(c.points / c.max) * 100}%` }}
              />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{c.detail}</p>
          </div>
        ))}

        <div
          className="mt-4 flex items-center justify-between rounded-lg border-2 px-3 py-2.5"
          style={{ borderColor: meta.color }}
        >
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Action recommandée
            </p>
            <p className="text-sm font-semibold" style={{ color: meta.color }}>
              {meta.label}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
