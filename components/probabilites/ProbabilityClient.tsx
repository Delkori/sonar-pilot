"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { SortableTh } from "@/components/ui/SortableTh";
import { TableWrap, theadRowClass } from "@/components/ui/Table";
import { SegmentBadge } from "@/components/ui/Badge";
import { fieldClass } from "@/lib/ui-classes";
import { cn, formatEUR, formatNumber, formatPct } from "@/lib/utils";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { buildProbabilityModel, CRITERIA } from "@/lib/probability";
import type { AccountProbability, ForecastSignalRow, ProbabilityModel, SaleRow } from "@/lib/probability";
import type { PurchaseLine } from "@/lib/sonarscore/velocity";
import { currentMonthIndex, fromMonthIndex, monthIndex, monthsFrom, MONTHS_LONG, MONTHS_SHORT } from "@/lib/dates";
import type { Account, AccountStatus, Segment } from "@/types/database";
import { ArrowDownRight, ArrowUpRight, Info } from "lucide-react";

type SortKey = "probability" | "expectedCa" | "name" | "lastOrder" | "segment";

/** « octobre 2026 » ou « octobre 2026 → décembre 2026 » selon la largeur de la fenêtre. */
function windowLabel(fromIdx: number, toIdx: number): string {
  const from = fromMonthIndex(fromIdx);
  const fromLabel = `${MONTHS_LONG[from.month - 1]} ${from.year}`;
  if (fromIdx === toIdx) return fromLabel;
  const to = fromMonthIndex(toIdx);
  return `${fromLabel} → ${MONTHS_LONG[to.month - 1]} ${to.year}`;
}

/**
 * Évaluation à afficher : celle des comptes ayant déjà commandé, dès qu'elle
 * est assez fournie. L'évaluation globale compte les prospects sans aucune
 * vente, que le modèle écarte sans mérite — elle flatte l'AUC.
 */
function evaluationAffichee(model: ProbabilityModel) {
  return model.evaluationClients.n >= 30 ? model.evaluationClients : model.evaluation;
}

/** Verdict lisible à partir du gain de Brier par rapport au taux de base. */
function fiabilite(model: ProbabilityModel): { label: string; tone: "good" | "ok" | "weak" | "none"; skill: number | null } {
  const { brier, brierBase, n } = evaluationAffichee(model);
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

interface Top10Row {
  accountId: string;
  name: string;
  expectedCa: number;
  probability: number;
}

/** Tooltip au survol d'une barre — valeur en € et probabilité du compte. */
function Top10Tooltip({ active, payload }: { active?: boolean; payload?: { payload: Top10Row }[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-foreground">{row.name}</p>
      <p className="text-muted-foreground">
        CA attendu <span className="font-medium text-foreground">{formatEUR(row.expectedCa)}</span>
      </p>
      <p className="text-muted-foreground">
        Probabilité <span className="font-medium text-foreground">{formatPct(row.probability)}</span>
      </p>
    </div>
  );
}

/**
 * Les dix comptes qui pèsent le plus dans le CA à aller chercher — classement
 * par CA attendu (probabilité × commande type), pas par probabilité seule :
 * un compte à 40 % sur un gros volume prime sur un compte à 80 % sur un petit.
 */
function Top10Chart({ rows }: { rows: Top10Row[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Pas encore assez de données pour un classement.</p>;
  }
  // Hauteur proportionnelle au nombre de lignes : un portefeuille avec moins
  // de dix comptes actifs ne doit pas laisser un grand vide sous le graphique.
  const height = Math.max(rows.length * 34, 120);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 4 }} barCategoryGap={8}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={168}
            tick={{ fontSize: 12, fill: "#64748B" }}
            tickLine={false}
            axisLine={false}
            interval={0}
          />
          <RechartsTooltip content={<Top10Tooltip />} cursor={{ fill: "#EEF2FF" }} />
          <Bar dataKey="expectedCa" radius={[0, 4, 4, 0]} maxBarSize={22}>
            {rows.map((r) => (
              <Cell key={r.accountId} fill="#4F46E5" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
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
  // Le mois choisi, pas un horizon abstrait : « jusqu'à décembre » ne laisse
  // aucun doute, contrairement à « 3 mois » (3 mois à partir de quand ?).
  const nowIdx = useMemo(() => currentMonthIndex(), []);
  const targetMonths = useMemo(() => monthsFrom(nowIdx + 1, 12), [nowIdx]);
  const [targetIdx, setTargetIdx] = useState(nowIdx + 3);
  const horizon = targetIdx - nowIdx;
  const currentWindowLabel = windowLabel(nowIdx + 1, targetIdx);
  const [search, setSearch] = useState("");
  const [cadence, setCadence] = useState("all");
  const [minProbability, setMinProbability] = useState(0);
  const [hideLost, setHideLost] = useState(true);
  const [segment, setSegment] = useState<Segment | "all">("all");
  const [status, setStatus] = useState<AccountStatus | "all">("all");

  // Entraînement + scoring à chaque changement d'horizon : quelques
  // centaines de millisecondes sur un portefeuille de plusieurs centaines de
  // comptes — voir le banc de mesure dans le commit qui introduit le modèle.
  const model = useMemo(
    () => buildProbabilityModel({ accounts, monthlySales, purchaseLines, forecasts, horizon }),
    [accounts, monthlySales, purchaseLines, forecasts, horizon]
  );

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);
  const verdict = fiabilite(model);
  const evaluation = evaluationAffichee(model);
  const surClients = evaluation === model.evaluationClients;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return model.accounts
      .map((r) => ({ ...r, account: accountById.get(r.accountId)! }))
      .filter((r) => r.account)
      .filter((r) => !hideLost || r.account.status !== "lost")
      .filter((r) => cadence === "all" || r.features.cadence === cadence)
      .filter((r) => r.probability >= minProbability)
      .filter((r) => segment === "all" || r.account.segment === segment)
      .filter((r) => status === "all" || r.account.status === status)
      .filter((r) => !q || r.account.name.toLowerCase().includes(q));
  }, [model, accountById, search, cadence, minProbability, hideLost, segment, status]);

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

  // Classement stable, indépendant des filtres du tableau ci-dessous : le
  // compte rendu montre toujours la même priorité, qu'on soit en train
  // d'explorer un sous-ensemble du portefeuille ou non.
  const top10: Top10Row[] = useMemo(
    () =>
      activeAccounts
        .filter((r) => r.expectedCa > 0)
        .sort((a, b) => b.expectedCa - a.expectedCa)
        .slice(0, 10)
        .map((r) => ({
          accountId: r.accountId,
          name: accountById.get(r.accountId)?.name ?? r.accountId,
          expectedCa: Math.round(r.expectedCa),
          probability: r.probability,
        })),
    [activeAccounts, accountById]
  );

  return (
    <div className="space-y-6">
      {/* ── Horizon + synthèse ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>D&apos;ici {currentWindowLabel}</CardTitle>
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
          <div className="flex items-center gap-2">
            <label htmlFor="chances-target-month" className="text-xs text-muted-foreground">
              Simuler jusqu&apos;à
            </label>
            <select
              id="chances-target-month"
              value={targetIdx}
              onChange={(e) => setTargetIdx(Number(e.target.value))}
              className={fieldClass}
            >
              {targetMonths.map((m) => {
                const idx = monthIndex(m.year, m.month);
                return (
                  <option key={idx} value={idx}>
                    {MONTHS_LONG[m.month - 1]} {m.year}
                  </option>
                );
              })}
            </select>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pt-0 lg:grid-cols-4">
          <Tile
            label="Comptes attendus en commande"
            value={formatNumber(Math.round(expectedActive))}
            hint={`sur ${formatNumber(activeAccounts.length)} comptes non perdus — somme des probabilités`}
            accent
          />
          <Tile
            label="CA à aller chercher"
            value={formatEUR(Math.round(expectedCaActive))}
            hint="probabilité × commande type × commandes attendues sur l'horizon"
            accent
          />
          <Tile
            label="Taux de base observé"
            value={formatPct(model.baseRate)}
            hint="part des situations passées suivies d'une commande"
          />
          <Tile
            label={`Fiabilité — ${verdict.label}`}
            value={evaluation.auc !== null ? `AUC ${evaluation.auc.toFixed(2)}` : "—"}
            hint={
              verdict.skill !== null
                ? `${surClients ? "sur les comptes ayant déjà commandé — " : ""}Brier ${evaluation.brier!.toFixed(3)} contre ${evaluation.brierBase!.toFixed(3)} au taux de base (gain ${formatPct(verdict.skill)})`
                : "pas assez d'historique pour évaluer"
            }
          />
        </CardContent>
      </Card>

      {/* ── Top 10 : où se trouve le CA à aller chercher ──────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Top 10 — priorité de contact</CardTitle>
          <CardDescription>
            Les dix comptes qui pèsent le plus dans le CA à aller chercher d&apos;ici {currentWindowLabel},
            classés par CA attendu (probabilité × commande type). Survolez une barre pour le détail.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Top10Chart rows={top10} />
        </CardContent>
      </Card>

      {/* ── Comptes ──────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Comptes — probabilité de commander d&apos;ici {currentWindowLabel}</CardTitle>
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
          <select value={segment} onChange={(e) => setSegment(e.target.value as Segment | "all")} className={fieldClass}>
            <option value="all">Tous segments</option>
            {(["A", "B", "C", "D", "E"] as const).map((s) => (
              <option key={s} value={s}>
                Segment {s}
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as AccountStatus | "all")} className={fieldClass}>
            <option value="all">Tous statuts</option>
            <option value="actif">Actif</option>
            <option value="a_risque">À risque</option>
            <option value="a_suivre">À suivre</option>
            <option value="new">Nouveau</option>
            <option value="reconnected">Reconquis</option>
            <option value="lost">Perdu</option>
          </select>
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

      {/* ── Comment le modèle raisonne (détail, sous la main courante) ── */}
      <div className="border-t border-border pt-6">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Comment le modèle raisonne
        </p>

        {/* ── Probabilité par critère ────────────────────────────────── */}
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
      </div>

      {/* ── Fiabilité ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Fiabilité des probabilités</CardTitle>
          <CardDescription>
            Sur les {formatNumber(evaluation.n)} situations les plus récentes
            {surClients ? " de comptes ayant déjà commandé" : ""}, que le modèle n&apos;a pas vues pendant
            l&apos;apprentissage : quand il annonce « 60 % », combien ont réellement commandé ?
            {surClients &&
              ` Les ${formatNumber(model.evaluation.n - model.evaluationClients.n)} situations de comptes sans aucune vente sont écartées : le modèle les classe sans mérite, elles flatteraient la mesure.`}
            {!evaluation.calibrated && " Fenêtre trop courte pour recalibrer : probabilités brutes."}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {evaluation.n === 0 ? (
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
                  {evaluation.reliability
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
