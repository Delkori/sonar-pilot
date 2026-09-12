"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/Button";
import { SortableTh } from "@/components/ui/SortableTh";
import { TableWrap, theadRowClass } from "@/components/ui/Table";
import { SegmentBadge } from "@/components/ui/Badge";
import { fieldClass } from "@/lib/ui-classes";
import { cn, formatEUR, formatNumber, formatPct } from "@/lib/utils";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { buildProbabilityModel, CRITERIA } from "@/lib/probability";
import type { AccountProbability, ForecastSignalRow, Horizon, ProbabilityModel, SaleRow } from "@/lib/probability";
import type { PurchaseLine } from "@/lib/sonarscore/velocity";
import { monthIndex, MONTHS_SHORT } from "@/lib/dates";
import type { Account } from "@/types/database";
import { ArrowDownRight, ArrowUpRight, Info } from "lucide-react";

type SortKey = "probability" | "expectedCa" | "name" | "lastOrder" | "segment";

const HORIZON_LABEL: Record<Horizon, string> = { 1: "1 mois", 3: "3 mois", 6: "6 mois" };

/** Verdict lisible à partir du gain de Brier par rapport au taux de base. */
function fiabilite(model: ProbabilityModel): { label: string; tone: "good" | "ok" | "weak" | "none"; skill: number | null } {
  const { brier, brierBase, n } = model.evaluation;
  if (brier === null || brierBase === null || brierBase === 0 || n < 30) return { label: "Non évaluée", tone: "none", skill: null };
  const skill = 1 - brier / brierBase;
  if (skill >= 0.3) return { label: "Bonne", tone: "good", skill };
  if (skill >= 0.1) return { label: "Correcte", tone: "ok", skill };
  return { label: "Faible", tone: "weak", skill };
}

function Tile({ label, value, hint, accent = false }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-3", accent ? "border-primary-100 bg-primary-50/50" : "border-border bg-surface")}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", accent ? "text-primary-700" : "text-foreground")}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Barre de probabilité : une seule teinte, la longueur porte la valeur. */
function ProbabilityBar({ value, baseRate, className }: { value: number; baseRate?: number; className?: string }) {
  return (
    <div className={cn("relative h-2 w-full overflow-hidden rounded-full bg-surface-muted", className)}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(value * 100)}%` }} />
      {baseRate !== undefined && (
        <div
          className="absolute inset-y-0 w-px bg-foreground/40"
          style={{ left: `${Math.round(baseRate * 100)}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}

function FactorChip({ factor }: { factor: AccountProbability["factors"][number] }) {
  const favorable = factor.weight > 0;
  const Icon = favorable ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      title={`${factor.label} : ${factor.levelLabel} — ${formatPct(factor.rate)} des comptes dans ce cas ont commandé`}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        favorable ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
      )}
    >
      <Icon size={11} className="shrink-0" />
      <span className="truncate">{factor.levelLabel}</span>
      <span className="shrink-0 opacity-80">{formatPct(factor.rate)}</span>
    </span>
  );
}

export function ProbabilityClient({
  accounts,
  monthlySales,
  purchaseLines,
  forecasts = [],
}: {
  accounts: Account[];
  monthlySales: SaleRow[];
  purchaseLines: PurchaseLine[];
  /** Prévisions saisies dans Planning — critère « vous l'aviez prévu ». */
  forecasts?: ForecastSignalRow[];
}) {
  const [horizon, setHorizon] = useState<Horizon>(3);
  const [search, setSearch] = useState("");
  const [cadence, setCadence] = useState("all");
  const [minProbability, setMinProbability] = useState(0);
  const [hideLost, setHideLost] = useState(true);

  // Entraînement + scoring à chaque changement d'horizon : quelques
  // centaines de millisecondes sur un portefeuille de plusieurs centaines de
  // comptes — voir le banc de mesure dans le commit qui introduit le modèle.
  const model = useMemo(
    () => buildProbabilityModel({ accounts, monthlySales, purchaseLines, forecasts, horizon }),
    [accounts, monthlySales, purchaseLines, forecasts, horizon]
  );

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);
  const verdict = fiabilite(model);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return model.accounts
      .map((r) => ({ ...r, account: accountById.get(r.accountId)! }))
      .filter((r) => r.account)
      .filter((r) => !hideLost || r.account.status !== "lost")
      .filter((r) => cadence === "all" || r.features.cadence === cadence)
      .filter((r) => r.probability >= minProbability)
      .filter((r) => !q || r.account.name.toLowerCase().includes(q));
  }, [model, accountById, search, cadence, minProbability, hideLost]);

  const { sorted, sortKey, dir, toggle } = useSortableTable<(typeof rows)[number], SortKey>(
    rows,
    {
      probability: (r) => r.probability,
      expectedCa: (r) => r.expectedCa,
      name: (r) => r.account.name,
      lastOrder: (r) => (r.lastOrder ? monthIndex(r.lastOrder.year, r.lastOrder.month) : null),
      segment: (r) => r.account.segment,
    },
    "probability"
  );

  const cadenceLevels = CRITERIA.find((c) => c.key === "cadence")!.levels;
  const evalWindow = model.evaluation.window;
  const activeAccounts = model.accounts.filter((r) => accountById.get(r.accountId)?.status !== "lost");
  const expectedActive = activeAccounts.reduce((s, r) => s + r.probability, 0);
  const expectedCaActive = activeAccounts.reduce((s, r) => s + r.expectedCa, 0);

  return (
    <div className="space-y-6">
      {/* ── Horizon + synthèse ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Dans les {HORIZON_LABEL[horizon]} à venir</CardTitle>
            <CardDescription>
              Modèle appris sur {formatNumber(model.sampleSize)} situations passées (compte × mois), dont{" "}
              {formatNumber(model.trainingSize)} pour l&apos;apprentissage et {formatNumber(model.evaluation.n)} pour
              l&apos;évaluation
              {evalWindow
                ? ` (${MONTHS_SHORT[evalWindow.from.month - 1]} ${evalWindow.from.year} → ${MONTHS_SHORT[evalWindow.to.month - 1]} ${evalWindow.to.year})`
                : ""}
              .
            </CardDescription>
          </div>
          <SegmentedControl
            value={String(horizon)}
            onChange={(v) => setHorizon(Number(v) as Horizon)}
            options={[
              { value: "1", label: "1 mois" },
              { value: "3", label: "3 mois" },
              { value: "6", label: "6 mois" },
            ]}
          />
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pt-0 lg:grid-cols-4">
          <Tile
            label="Comptes attendus en commande"
            value={formatNumber(Math.round(expectedActive))}
            hint={`sur ${formatNumber(activeAccounts.length)} comptes non perdus — somme des probabilités`}
            accent
          />
          <Tile
            label="CA attendu"
            value={formatEUR(Math.round(expectedCaActive))}
            hint="probabilité × commande type × commandes attendues sur l'horizon"
          />
          <Tile
            label="Taux de base observé"
            value={formatPct(model.baseRate)}
            hint="part des situations passées suivies d'une commande"
          />
          <Tile
            label={`Fiabilité — ${verdict.label}`}
            value={model.evaluation.auc !== null ? `AUC ${model.evaluation.auc.toFixed(2)}` : "—"}
            hint={
              verdict.skill !== null
                ? `Brier ${model.evaluation.brier!.toFixed(3)} contre ${model.evaluation.brierBase!.toFixed(3)} au taux de base (gain ${formatPct(verdict.skill)})`
                : "pas assez d'historique pour évaluer"
            }
          />
        </CardContent>
      </Card>

      {/* ── Probabilité par critère ──────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Probabilité de commande selon chaque critère</h2>
          <p className="text-xs text-muted-foreground">
            Fréquences observées sur l&apos;historique · le trait vertical marque le taux de base ({formatPct(model.baseRate)})
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {model.criteria.map((c) => (
            <Card key={c.key}>
              <CardHeader>
                <CardTitle>{c.label}</CardTitle>
                <CardDescription>{c.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 pt-3">
                {c.levels.length === 0 && <p className="text-xs text-muted-foreground">Aucune donnée.</p>}
                {c.levels.map((lv) => (
                  <div
                    key={lv.value}
                    title={`${lv.label} : ${formatPct(lv.rate)} de commande sur ${formatNumber(lv.n)} situations`}
                  >
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="truncate text-foreground">{lv.label}</span>
                      <span className="shrink-0 tabular-nums">
                        <span className="font-semibold text-foreground">{formatPct(lv.rate)}</span>
                        <span className="ml-1.5 text-muted-foreground">n = {formatNumber(lv.n)}</span>
                      </span>
                    </div>
                    <ProbabilityBar value={lv.rate} baseRate={model.baseRate} className="mt-1" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* ── Fiabilité ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Fiabilité des probabilités</CardTitle>
          <CardDescription>
            Sur les {formatNumber(model.evaluation.n)} situations les plus récentes, que le modèle n&apos;a pas vues pendant
            l&apos;apprentissage : quand il annonce « 60 % », combien ont réellement commandé ?
            {!model.evaluation.calibrated && " Fenêtre trop courte pour recalibrer : probabilités brutes."}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {model.evaluation.n === 0 ? (
            <p className="text-sm text-muted-foreground">Pas encore assez d&apos;historique pour évaluer le modèle.</p>
          ) : (
            <TableWrap>
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className={theadRowClass}>
                    <th className="px-3 py-2 font-medium">Probabilité annoncée</th>
                    <th className="px-3 py-2 text-right font-medium">Moyenne annoncée</th>
                    <th className="px-3 py-2 text-right font-medium">Réellement commandé</th>
                    <th className="px-3 py-2 text-right font-medium">Écart</th>
                    <th className="px-3 py-2 text-right font-medium">Situations</th>
                  </tr>
                </thead>
                <tbody>
                  {model.evaluation.reliability
                    .filter((b) => b.n > 0)
                    .map((b) => {
                      const ecart = b.observed - b.predicted;
                      return (
                        <tr key={b.from} className="border-b border-border/60 last:border-0">
                          <td className="px-3 py-2 tabular-nums text-foreground">
                            {Math.round(b.from * 100)} – {Math.round(b.to * 100)} %
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatPct(b.predicted)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium text-foreground">{formatPct(b.observed)}</td>
                          <td
                            className={cn(
                              "px-3 py-2 text-right tabular-nums",
                              Math.abs(ecart) >= 0.15 ? "text-warning" : "text-muted-foreground"
                            )}
                          >
                            {ecart > 0 ? "+" : ""}
                            {Math.round(ecart * 100)} pts
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(b.n)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      {/* ── Comptes ──────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Comptes — probabilité de commander dans les {HORIZON_LABEL[horizon]}</CardTitle>
          <CardDescription>
            Chaque probabilité se décompose en facteurs : le plus favorable et le plus défavorable sont affichés, avec le
            taux de commande observé sur les comptes dans le même cas.
          </CardDescription>
        </CardHeader>
        <div className="flex flex-wrap items-center gap-2 border-y border-border px-5 py-3">
          <input
            type="search"
            placeholder="Rechercher un compte…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(fieldClass, "min-w-56")}
          />
          <select value={cadence} onChange={(e) => setCadence(e.target.value)} className={fieldClass}>
            <option value="all">Toutes cadences</option>
            {cadenceLevels.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <select value={minProbability} onChange={(e) => setMinProbability(Number(e.target.value))} className={fieldClass}>
            <option value={0}>Toutes probabilités</option>
            <option value={0.25}>≥ 25 %</option>
            <option value={0.5}>≥ 50 %</option>
            <option value={0.75}>≥ 75 %</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={hideLost} onChange={(e) => setHideLost(e.target.checked)} />
            Masquer les comptes perdus
          </label>
          <span className="ml-auto text-xs text-muted-foreground">
            {formatNumber(sorted.length)} compte(s) · {formatNumber(Math.round(sorted.reduce((s, r) => s + r.probability, 0)))}{" "}
            attendu(s) en commande
          </span>
        </div>
        <TableWrap>
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className={theadRowClass}>
                <SortableTh label="Compte" sortKey="name" activeKey={sortKey} dir={dir} onSort={toggle} className="px-5" />
                <SortableTh label="Segment" sortKey="segment" activeKey={sortKey} dir={dir} onSort={toggle} />
                <th className="px-3 py-3 font-medium">Cadence</th>
                <SortableTh label="Dernière commande" sortKey="lastOrder" activeKey={sortKey} dir={dir} onSort={toggle} />
                <SortableTh label="Probabilité" sortKey="probability" activeKey={sortKey} dir={dir} onSort={toggle} className="min-w-44" />
                <SortableTh label="CA attendu" sortKey="expectedCa" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
                <th className="px-3 py-3 font-medium">Facteurs déterminants</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-muted-foreground">
                    Aucun compte ne correspond aux filtres.
                  </td>
                </tr>
              )}
              {sorted.map((r) => {
                const favorable = r.factors.filter((f) => f.weight > 0)[0];
                const defavorable = r.factors.filter((f) => f.weight < 0)[0];
                const cadenceLabel = cadenceLevels.find((l) => l.value === r.features.cadence)?.label ?? r.features.cadence;
                return (
                  <tr key={r.accountId} className="border-b border-border/60 last:border-0 hover:bg-surface-muted/60">
                    <td className="px-5 py-2.5">
                      <Link href={`/comptes/${r.accountId}`} className="font-medium text-foreground hover:text-primary">
                        {r.account.name}
                      </Link>
                      {r.account.price_list && (
                        <span className="ml-2 text-xs text-muted-foreground">{r.account.price_list}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <SegmentBadge segment={r.account.segment} />
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{cadenceLabel}</td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                      {r.lastOrder ? `${MONTHS_SHORT[r.lastOrder.month - 1]} ${r.lastOrder.year}` : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <ProbabilityBar value={r.probability} className="w-24" />
                        <span className="w-10 text-right tabular-nums font-semibold text-foreground">
                          {formatPct(r.probability)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                      {r.expectedCa > 0 ? formatEUR(Math.round(r.expectedCa)) : "—"}
                    </td>
                    <td className="max-w-md px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {favorable && <FactorChip factor={favorable} />}
                        {defavorable && <FactorChip factor={defavorable} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          Le modèle n&apos;utilise, pour chaque situation passée, que ce qui était connu à l&apos;époque — jamais une
          commande postérieure. Les critères sont combinés par régression logistique, puis les probabilités sont
          recalibrées sur les mois les plus récents pour que « 60 % » corresponde bien à six commandes sur dix. Le CA
          attendu est une espérance, pas une prévision ligne à ligne : pour planifier, passez par Pilotage.
        </span>
      </p>
    </div>
  );
}
