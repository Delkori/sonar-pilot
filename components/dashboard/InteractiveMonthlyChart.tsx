"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { formatEUR } from "@/lib/utils";

const MONTH_LABELS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];

interface InteractiveMonthlyChartProps {
  year: number;
  caByMonth: number[];
  objectifByMonth: number[];
  forecastByMonth: number[];
  selectedMonth: number | null;
  onSelectMonth: (m: number | null) => void;
}

export function InteractiveMonthlyChart({
  year,
  caByMonth,
  objectifByMonth,
  forecastByMonth,
  selectedMonth,
  onSelectMonth,
}: InteractiveMonthlyChartProps) {
  const chartData = MONTH_LABELS.map((label, index) => ({
    monthNum: index + 1,
    name: label,
    Réalisé: caByMonth[index] || 0,
    Objectif: objectifByMonth[index] || 0,
    Prévisionnel: forecastByMonth[index] || 0,
  }));

  const hasObjectif = objectifByMonth.some((v) => v > 0);
  const hasForecast = forecastByMonth.some((v) => v > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Évolution Mensuelle — {year}</CardTitle>
          <CardDescription>
            Comparaison dynamique entre le CA Réalisé, les Objectifs et vos Prévisions mensuelles. Cliquez sur un mois pour filtrer le dashboard.
          </CardDescription>
        </div>
        {selectedMonth !== null && (
          <button
            onClick={() => onSelectMonth(null)}
            className="rounded-md border border-border bg-surface-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground transition-colors"
          >
            Vue Annuelle (Réinitialiser)
          </button>
        )}
      </CardHeader>
      <CardContent>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
              onClick={(state: Record<string, unknown> | null) => {
                if (
                  state &&
                  "activePayload" in state &&
                  Array.isArray(state.activePayload) &&
                  state.activePayload.length > 0
                ) {
                  const payloadObj = state.activePayload[0] as { payload?: { monthNum?: number } };
                  const m = payloadObj.payload?.monthNum;
                  if (m) onSelectMonth(selectedMonth === m ? null : m);
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#64748B" />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="#64748B"
                tickFormatter={(val) => `${(val / 1000).toFixed(0)}k€`}
              />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any) => [formatEUR(Number(value)), ""]}
                contentStyle={{
                  backgroundColor: "#FFFFFF",
                  borderColor: "#E2E8F0",
                  borderRadius: "8px",
                  boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
                }}
              />
              <Legend wrapperStyle={{ paddingTop: "10px", fontSize: "12px" }} />

              <Bar
                dataKey="Réalisé"
                fill="#4F46E5"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
              {hasObjectif && (
                <Line
                  type="monotone"
                  dataKey="Objectif"
                  stroke="#F59E0B"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "#F59E0B" }}
                />
              )}
              {hasForecast && (
                <Line
                  type="monotone"
                  dataKey="Prévisionnel"
                  stroke="#94A3B8"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={{ r: 3, fill: "#94A3B8" }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
