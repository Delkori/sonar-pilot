"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { formatEUR, formatPct } from "@/lib/utils";
import { computeTargetingScore } from "@/lib/scoring";
import type { Account } from "@/types/database";
import { MapPin } from "lucide-react";

export const DEPT_NAMES: Record<string, string> = {
  "01": "Ain",
  "03": "Allier",
  "07": "Ardèche",
  "15": "Cantal",
  "26": "Drôme",
  "38": "Isère",
  "42": "Loire",
  "43": "Haute-Loire",
  "58": "Nièvre",
  "63": "Puy-de-Dôme",
  "69": "Rhône",
  "71": "Saône-et-Loire",
  "73": "Savoie",
  "74": "Haute-Savoie",
};

interface DepartmentBreakdownProps {
  accounts: Account[];
  yearField: keyof Account;
  selectedDept: string | null;
  onSelectDept: (dept: string | null) => void;
}

export function DepartmentBreakdown({
  accounts,
  yearField,
  selectedDept,
  onSelectDept,
}: DepartmentBreakdownProps) {
  const deptStats = useMemo(() => {
    const map = new Map<
      string,
      {
        code: string;
        name: string;
        totalAccounts: number;
        activeAccounts: number;
        ca: number;
        caNonCapte: number;
      }
    >();

    for (const account of accounts) {
      // extraire le code département depuis account.department_code ou le postal_code
      let code = account.department_code;
      if (!code && account.postal_code) {
        code = account.postal_code.slice(0, 2);
      }
      if (!code) code = "NC"; // Non Classé

      const deptName = DEPT_NAMES[code] ?? (code === "NC" ? "Non renseigné" : `Dép ${code}`);
      const score = computeTargetingScore(account);
      const caVal = (account[yearField] as number | null) ?? 0;

      const existing = map.get(code) ?? {
        code,
        name: deptName,
        totalAccounts: 0,
        activeAccounts: 0,
        ca: 0,
        caNonCapte: 0,
      };

      existing.totalAccounts++;
      if (account.status === "actif") existing.activeAccounts++;
      existing.ca += caVal;
      existing.caNonCapte += score.caNonCapte;

      map.set(code, existing);
    }

    const totalSectorCa = Array.from(map.values()).reduce((sum, d) => sum + d.ca, 1);

    return Array.from(map.values())
      .map((d) => ({
        ...d,
        caShare: d.ca / totalSectorCa,
      }))
      .sort((a, b) => b.ca - a.ca);
  }, [accounts, yearField]);

  const maxCa = Math.max(...deptStats.map((d) => d.ca), 1);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Répartition par Département (Auvergne-Rhône-Alpes)</CardTitle>
          <CardDescription>
            Performance commerciale et potentiel non capté par département du secteur. Cliquez sur un département pour filtrer.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {selectedDept && (
            <button
              onClick={() => onSelectDept(null)}
              className="rounded-md border border-border bg-surface-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground transition-colors"
            >
              Réinitialiser le filtre ({selectedDept})
            </button>
          )}
          <MapPin size={18} className="text-primary" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {deptStats.map((dept) => {
            const isSelected = selectedDept === dept.code;
            return (
              <div
                key={dept.code}
                onClick={() => onSelectDept(isSelected ? null : dept.code)}
                className={`cursor-pointer rounded-lg border p-3 transition-all hover:border-primary ${
                  isSelected
                    ? "border-primary bg-primary-50/50 ring-2 ring-primary/20"
                    : "border-border bg-surface hover:bg-surface-muted/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-6 w-6 items-center justify-center rounded bg-primary-100 text-xs font-bold text-primary-700">
                      {dept.code}
                    </span>
                    <span className="text-sm font-semibold text-foreground">{dept.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {dept.activeAccounts}/{dept.totalAccounts} actifs
                  </span>
                </div>

                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-lg font-bold text-foreground">{formatEUR(dept.ca)}</span>
                  <span className="text-xs font-medium text-muted-foreground">{formatPct(dept.caShare)} du secteur</span>
                </div>

                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Potentiel non capté :</span>
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    {formatEUR(dept.caNonCapte)}
                  </span>
                </div>

                <div className="mt-2 h-1.5 w-full rounded-full bg-surface-muted">
                  <div
                    className="h-1.5 rounded-full bg-primary transition-all"
                    style={{ width: `${(dept.ca / maxCa) * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
