"use client";

import { useMemo, useState } from "react";
import * as d3geo from "d3-geo";
import { SegmentBadge, StatusBadge } from "@/components/ui/Badge";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatEUR, formatNumber, formatPct } from "@/lib/utils";
import { detectOpportunities, OPPORTUNITY_META } from "@/lib/opportunities";
import { computeTargetingScore } from "@/lib/scoring";
import { suggestMonthlyForecast } from "@/lib/forecast";
import { createClient } from "@/lib/supabase/client";
import type { Account, Segment, AccountStatus } from "@/types/database";
import Link from "next/link";
import {
  X,
  Sparkles,
  CheckCircle2,
  Loader2,
  Users,
  TrendingUp,
  MapPin,
  Package,
  Award,
} from "lucide-react";

type SortKey = "name" | "segment" | "city" | "status" | "score" | "ca_ytd";

interface DeptFeature {
  type: "Feature";
  properties: { code: string; nom: string };
  geometry: GeoJSON.Geometry;
}

interface ProductRow {
  account_id: string;
  brand: string;
  sales_value_cy: number | null;
  sales_value_ly: number | null;
  qty_ordered_cy: number | null;
  qty_ordered_ly: number | null;
}

// Carte plus compacte
const WIDTH = 500;
const HEIGHT = 520;

function ecartRatio(a: Account) {
  if (!a.objectif_boites) return null;
  return ((a.realise_boites ?? 0) - a.objectif_boites) / a.objectif_boites;
}

function deptColor(ratio: number | null, caVal: number, maxCa: number) {
  // Si on a un objectif/réalisé, on colorie selon l'écart
  if (ratio !== null) {
    if (ratio >= 0) return "#4F46E5";     // Objectif atteint — indigo
    if (ratio >= -0.25) return "#818CF8"; // Léger — indigo clair
    if (ratio >= -0.5) return "#FCD34D";  // Modéré — jaune
    return "#FCA5A5";                      // Critique — rouge clair
  }
  // Sinon heatmap CA : plus c'est foncé, plus c'est élevé
  if (maxCa === 0 || caVal === 0) return "#E2E8F0";
  const intensity = caVal / maxCa;
  if (intensity > 0.7) return "#4F46E5";
  if (intensity > 0.4) return "#818CF8";
  if (intensity > 0.15) return "#C7D2FE";
  return "#EEF2FF";
}

export function AuraMap({
  geo,
  accounts,
  products = [],
}: {
  geo: { type: "FeatureCollection"; features: DeptFeature[] };
  accounts: Account[];
  products?: ProductRow[];
}) {
  const [segment, setSegment] = useState<Segment | "all">("all");
  const [status, setStatus] = useState<AccountStatus | "all">("all");
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [showOnlyOpportunities, setShowOnlyOpportunities] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [planned, setPlanned] = useState<Set<string>>(new Set());

  const opportunityByAccount = useMemo(() => {
    const opps = detectOpportunities(accounts);
    return new Map(opps.map((o) => [o.account.id, o] as const));
  }, [accounts]);

  async function planNextMonth(account: Account) {
    setPlanning(true);
    const now = new Date();
    let y = now.getFullYear();
    let m = now.getMonth() + 2;
    if (m > 12) { m = 1; y++; }
    const [suggestion] = suggestMonthlyForecast(account, [{ year: y, month: m }]);
    const opp = opportunityByAccount.get(account.id);
    const supabase = createClient();
    await supabase.from("account_forecasts").upsert(
      {
        account_id: account.id,
        year: y,
        month: m,
        kind: "prevision",
        boites_prevues: suggestion.boites_prevues,
        ca_prevu: suggestion.ca_prevu,
        note: opp ? `${opp.label} — ${opp.reason}` : suggestion.note,
      },
      { onConflict: "account_id,year,month,kind" }
    );
    setPlanning(false);
    setPlanned((prev) => new Set(prev).add(account.id));
  }

  const filtered = useMemo(
    () =>
      accounts.filter((a) => {
        if (segment !== "all" && a.segment !== segment) return false;
        if (status !== "all" && a.status !== status) return false;
        if (selectedDept && a.department_code !== selectedDept) return false;
        if (showOnlyOpportunities && !opportunityByAccount.has(a.id)) return false;
        return true;
      }),
    [accounts, segment, status, selectedDept, showOnlyOpportunities, opportunityByAccount]
  );

  const projection = useMemo(
    () => d3geo.geoConicConformal().fitExtent([[10, 10], [WIDTH - 10, HEIGHT - 10]], geo),
    [geo]
  );
  const pathGen = useMemo(() => d3geo.geoPath(projection), [projection]);

  // ── Statistiques par département (comptes + CA + objectif/réalisé)
  const deptStats = useMemo(() => {
    const map = new Map<string, {
      objectif: number;
      realise: number;
      count: number;
      activeCount: number;
      ca: number;
      centroid: [number, number] | null;
    }>();
    for (const a of accounts) {
      if (!a.department_code) continue;
      const cur = map.get(a.department_code) ?? {
        objectif: 0, realise: 0, count: 0, activeCount: 0, ca: 0, centroid: null,
      };
      cur.objectif += a.objectif_boites ?? 0;
      cur.realise += a.realise_boites ?? 0;
      cur.ca += a.ca_2026_ytd ?? 0;
      cur.count += 1;
      if (a.status === "actif") cur.activeCount += 1;
      map.set(a.department_code, cur);
    }
    // Calculer les centroïdes d3 pour placer les étiquettes
    for (const f of geo.features) {
      const st = map.get(f.properties.code);
      if (st) {
        const centroid = pathGen.centroid(f as unknown as d3geo.GeoPermissibleObjects);
        st.centroid = centroid ? [centroid[0], centroid[1]] : null;
        map.set(f.properties.code, st);
      }
    }
    return map;
  }, [accounts, geo, pathGen]);

  // ── Ventes produits par département (account_id → dept_code)
  const accountDeptMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) {
      if (a.department_code) m.set(a.id, a.department_code);
    }
    return m;
  }, [accounts]);

  const productsByDept = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const p of products) {
      const deptCode = accountDeptMap.get(p.account_id);
      if (!deptCode) continue;
      const deptMap = map.get(deptCode) ?? new Map<string, number>();
      const current = deptMap.get(p.brand) ?? 0;
      deptMap.set(p.brand, current + (p.sales_value_cy ?? 0));
      map.set(deptCode, deptMap);
    }
    return map;
  }, [products, accountDeptMap]);

  // Top marque par département
  const topBrandByDept = useMemo(() => {
    const result = new Map<string, { brand: string; value: number }>();
    for (const [deptCode, brandMap] of productsByDept.entries()) {
      let topBrand = "";
      let topValue = 0;
      for (const [brand, value] of brandMap.entries()) {
        if (value > topValue) { topBrand = brand; topValue = value; }
      }
      if (topBrand) result.set(deptCode, { brand: topBrand, value: topValue });
    }
    return result;
  }, [productsByDept]);

  // Top marques globales (toutes marques confondues)
  const globalBrandTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of products) {
      totals.set(p.brand, (totals.get(p.brand) ?? 0) + (p.sales_value_cy ?? 0));
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [products]);

  // Classement départements par CA
  const deptRanking = useMemo(() => {
    return Array.from(deptStats.entries())
      .map(([code, stats]) => ({
        code,
        nom: geo.features.find((f) => f.properties.code === code)?.properties.nom ?? code,
        ...stats,
        topBrand: topBrandByDept.get(code)?.brand ?? "—",
      }))
      .sort((a, b) => b.ca - a.ca);
  }, [deptStats, geo, topBrandByDept]);

  const maxCa = useMemo(() => Math.max(...Array.from(deptStats.values()).map((s) => s.ca), 1), [deptStats]);

  const geolocated = filtered.filter((a) => a.latitude !== null && a.longitude !== null);

  const { sorted: sortedFiltered, sortKey, dir, toggle } = useSortableTable<Account, SortKey>(
    filtered,
    {
      name: (a) => a.name,
      segment: (a) => a.segment,
      city: (a) => a.city,
      status: (a) => a.status,
      score: (a) => computeTargetingScore(a).total,
      ca_ytd: (a) => a.ca_2026_ytd,
    },
    "score"
  );

  // ── KPI sectoriaux globaux
  const totalCa = useMemo(() => accounts.reduce((s, a) => s + (a.ca_2026_ytd ?? 0), 0), [accounts]);
  const totalActifs = accounts.filter((a) => a.status === "actif").length;
  const topDept = deptRanking[0];
  const topGlobalBrand = globalBrandTotals[0];

  const selectedDeptStats = selectedDept ? deptStats.get(selectedDept) : null;
  const selectedDeptFeature = selectedDept ? geo.features.find((f) => f.properties.code === selectedDept) : null;
  const selectedDeptBrands = selectedDept
    ? Array.from(productsByDept.get(selectedDept)?.entries() ?? [])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
    : [];

  return (
    <div className="space-y-4">

      {/* ── Barre de KPI Territoriaux ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50">
            <Users size={16} className="text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Clients Actifs</p>
            <p className="text-lg font-bold text-foreground">{formatNumber(totalActifs)}</p>
            <p className="text-[10px] text-muted-foreground">{formatNumber(accounts.length)} suivis</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50">
            <TrendingUp size={16} className="text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">CA Secteur</p>
            <p className="text-lg font-bold text-foreground">{formatEUR(totalCa)}</p>
            <p className="text-[10px] text-muted-foreground">YTD 2026</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50">
            <MapPin size={16} className="text-amber-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Dép. Leader</p>
            <p className="text-lg font-bold text-foreground">{topDept?.code ?? "—"}</p>
            <p className="text-[10px] text-muted-foreground">{topDept ? formatEUR(topDept.ca) : "—"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
            <Package size={16} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Marque #1</p>
            <p className="text-base font-bold text-foreground truncate">{topGlobalBrand?.[0] ?? "—"}</p>
            <p className="text-[10px] text-muted-foreground">{topGlobalBrand ? formatEUR(topGlobalBrand[1]) : "Données manquantes"}</p>
          </div>
        </div>
      </div>

      {/* ── Layout principal : 3 colonnes ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr_260px]">

        {/* ── Colonne gauche : filtres + légende ── */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filtres</p>
            <label className="mb-1 block text-xs text-muted-foreground">Segment</label>
            <select
              value={segment}
              onChange={(e) => setSegment(e.target.value as Segment | "all")}
              className="mb-3 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
            >
              <option value="all">Tous</option>
              {(["A", "B", "C", "D", "E"] as const).map((s) => (
                <option key={s} value={s}>Segment {s}</option>
              ))}
            </select>
            <label className="mb-1 block text-xs text-muted-foreground">Statut</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as AccountStatus | "all")}
              className="mb-3 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
            >
              <option value="all">Tous</option>
              <option value="actif">Actif</option>
              <option value="lost">Lost</option>
              <option value="a_risque">À risque</option>
              <option value="a_suivre">À suivre</option>
            </select>
            <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={showOnlyOpportunities}
                onChange={(e) => setShowOnlyOpportunities(e.target.checked)}
                className="accent-primary"
              />
              <Sparkles size={14} className="text-primary" />
              Opportunités uniquement
            </label>
            {selectedDept && (
              <button
                onClick={() => setSelectedDept(null)}
                className="w-full rounded-lg border border-border px-2 py-1.5 text-sm text-muted-foreground hover:bg-surface-muted"
              >
                ✕ Réinitialiser le filtre
              </button>
            )}
          </div>

          <div className="rounded-xl border border-border bg-surface p-4 text-sm">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Légende</p>
            <LegendRow color="#4F46E5" label="Objectif atteint" />
            <LegendRow color="#818CF8" label="Écart léger (−25%)" />
            <LegendRow color="#FCD34D" label="Écart modéré (−50%)" />
            <LegendRow color="#FCA5A5" label="Écart critique (< −50%)" />
            <LegendRow color="#E2E8F0" label="Pas de donnée" />
            <div className="mt-3 border-t border-border pt-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Heatmap CA (sans objectif)</p>
              <div className="flex h-2 rounded-full overflow-hidden">
                {["#EEF2FF", "#C7D2FE", "#818CF8", "#4F46E5"].map((c) => (
                  <div key={c} className="flex-1" style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
                <span>Faible</span><span>Fort</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Centre : carte SVG ── */}
        <div className="rounded-xl border border-border bg-surface p-3 flex flex-col items-center">
          <p className="mb-2 text-xs font-semibold text-muted-foreground text-center uppercase tracking-wide">
            {selectedDept && selectedDeptFeature
              ? `${selectedDeptFeature.properties.nom} (${selectedDept}) — ${selectedDeptStats?.count ?? 0} comptes`
              : "Cliquez sur un département pour filtrer"}
          </p>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ maxHeight: 340, maxWidth: 380, width: "100%" }}>
            {geo.features.map((f) => {
              const stats = deptStats.get(f.properties.code);
              const ratio = stats && stats.objectif > 0 ? (stats.realise - stats.objectif) / stats.objectif : null;
              const caVal = stats?.ca ?? 0;
              const fill = deptColor(ratio, caVal, maxCa);
              const isSelected = selectedDept === f.properties.code;
              const centroid = stats?.centroid;

              return (
                <g key={f.properties.code}>
                  <path
                    d={pathGen(f as unknown as d3geo.GeoPermissibleObjects) ?? ""}
                    fill={fill}
                    stroke="#ffffff"
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    opacity={selectedDept && !isSelected ? 0.3 : 1}
                    className="cursor-pointer transition-all duration-150 hover:brightness-110"
                    onClick={() => setSelectedDept(isSelected ? null : f.properties.code)}
                  >
                    <title>{f.properties.nom} — {formatNumber(stats?.count ?? 0)} comptes · {formatEUR(stats?.ca ?? 0)}</title>
                  </path>

                  {/* Étiquette SVG sur le département */}
                  {centroid && (
                    <g
                      style={{ pointerEvents: "none" }}
                      opacity={selectedDept && !isSelected ? 0.3 : 1}
                    >
                      {/* Code département */}
                      <text
                        x={centroid[0]}
                        y={centroid[1] - 8}
                        textAnchor="middle"
                        fontSize={11}
                        fontWeight="700"
                        fill="#1e1b4b"
                        className="select-none"
                      >
                        {f.properties.code}
                      </text>
                      {/* Nb clients */}
                      {stats && stats.count > 0 && (
                        <text
                          x={centroid[0]}
                          y={centroid[1] + 5}
                          textAnchor="middle"
                          fontSize={8.5}
                          fill="#3730a3"
                          className="select-none"
                        >
                          {stats.count} client{stats.count > 1 ? "s" : ""}
                        </text>
                      )}
                      {/* Top marque */}
                      {topBrandByDept.get(f.properties.code) && (
                        <text
                          x={centroid[0]}
                          y={centroid[1] + 16}
                          textAnchor="middle"
                          fontSize={7}
                          fill="#4338ca"
                          opacity={0.85}
                          className="select-none"
                        >
                          {topBrandByDept.get(f.properties.code)!.brand}
                        </text>
                      )}
                    </g>
                  )}
                </g>
              );
            })}

            {/* Points comptes géolocalisés */}
            {geolocated.map((a) => {
              const coords = projection([a.longitude!, a.latitude!]);
              if (!coords) return null;
              const [x, y] = coords;
              const ratio = ecartRatio(a);
              const opp = opportunityByAccount.get(a.id);
              const r = a.segment === "A" ? 5 : a.segment === "B" ? 4 : 3;
              return (
                <g key={a.id} className="cursor-pointer" onClick={() => setSelectedAccount(a)}>
                  {opp && (
                    <circle
                      cx={x} cy={y} r={r + 4}
                      fill="none"
                      stroke={OPPORTUNITY_META[opp.type].color}
                      strokeWidth={1.5}
                      opacity={0.85}
                    />
                  )}
                  <circle
                    cx={x} cy={y} r={r}
                    fill={ratio !== null && ratio < -0.5 ? "#dc2626" : "#4338ca"}
                    stroke="#ffffff"
                    strokeWidth={1.2}
                  >
                    <title>{opp ? `${a.name} — ${opp.label}` : a.name}</title>
                  </circle>
                </g>
              );
            })}
          </svg>
          {geolocated.length === 0 && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Aucun compte géocodé — lancez le géocodage depuis Import.
            </p>
          )}
        </div>

        {/* ── Colonne droite : détails dépt sélectionné + classement ── */}
        <div className="space-y-4">

          {/* Détails du département sélectionné */}
          {selectedDeptStats && selectedDeptFeature ? (
            <div className="rounded-xl border border-border bg-surface p-4 text-sm">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {selectedDeptFeature.properties.nom}
                </p>
                <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-bold text-primary-700">
                  {selectedDept}
                </span>
              </div>
              <Row label="Total comptes" value={formatNumber(selectedDeptStats.count)} />
              <Row label="Comptes actifs" value={formatNumber(selectedDeptStats.activeCount)} />
              <Row label="CA YTD 2026" value={formatEUR(selectedDeptStats.ca)} />
              {selectedDeptStats.objectif > 0 && (
                <>
                  <Row label="Objectif boîtes" value={formatNumber(selectedDeptStats.objectif)} />
                  <Row label="Réalisé boîtes" value={formatNumber(selectedDeptStats.realise)} />
                  <Row
                    label="Atteinte"
                    value={formatPct(selectedDeptStats.objectif > 0 ? selectedDeptStats.realise / selectedDeptStats.objectif : null)}
                  />
                </>
              )}

              {/* Top marques du département */}
              {selectedDeptBrands.length > 0 && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                    <Award size={12} /> Top Produits
                  </p>
                  {selectedDeptBrands.map(([brand, value], idx) => {
                    const max = selectedDeptBrands[0]?.[1] ?? 1;
                    return (
                      <div key={brand} className="mb-2">
                        <div className="flex items-center justify-between text-xs mb-0.5">
                          <span className="font-medium text-foreground flex items-center gap-1">
                            {idx === 0 && <span className="text-amber-500">★</span>}
                            {brand}
                          </span>
                          <span className="text-muted-foreground">{formatEUR(value)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-surface-muted">
                          <div
                            className="h-1.5 rounded-full bg-primary"
                            style={{ width: `${(value / max) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* Classement des départements */
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Classement par CA
              </p>
              <div className="space-y-2">
                {deptRanking.slice(0, 8).map((dept, idx) => {
                  const share = totalCa > 0 ? dept.ca / totalCa : 0;
                  return (
                    <div
                      key={dept.code}
                      onClick={() => setSelectedDept(dept.code)}
                      className="cursor-pointer rounded-lg p-2 transition-colors hover:bg-surface-muted"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-medium text-foreground">
                          <span className="text-[10px] text-muted-foreground">{idx + 1}.</span>
                          <span className="rounded bg-primary-100 px-1 py-0.5 text-[10px] font-bold text-primary-700">{dept.code}</span>
                          {dept.nom}
                        </span>
                        <span className="text-muted-foreground">{dept.count}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-surface-muted">
                          <div className="h-1.5 rounded-full bg-primary" style={{ width: `${share * 100}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground w-14 text-right">{formatEUR(dept.ca)}</span>
                      </div>
                      {dept.topBrand !== "—" && (
                        <p className="mt-0.5 text-[9px] text-muted-foreground">⬡ {dept.topBrand}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top marques globales */}
          {globalBrandTotals.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Package size={12} /> Top 5 Marques — Secteur
              </p>
              {globalBrandTotals.map(([brand, value], idx) => {
                const max = globalBrandTotals[0]?.[1] ?? 1;
                return (
                  <div key={brand} className="mb-2">
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="font-medium text-foreground flex items-center gap-1">
                        {idx === 0 && <span className="text-amber-500">★</span>}
                        {brand}
                      </span>
                      <span className="text-muted-foreground">{formatEUR(value)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-muted">
                      <div
                        className="h-1.5 rounded-full"
                        style={{
                          width: `${(value / max) * 100}%`,
                          backgroundColor: idx === 0 ? "#4F46E5" : idx === 1 ? "#818CF8" : "#C7D2FE",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Tableau des comptes filtrés ── */}
      <div className="rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">
            {selectedDept
              ? `Comptes — ${geo.features.find((f) => f.properties.code === selectedDept)?.properties.nom ?? selectedDept}`
              : "Tous les comptes filtrés"}
          </p>
          <span className="text-xs text-muted-foreground">{filtered.length} compte(s)</span>
        </div>
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <SortableTh label="Compte" sortKey="name" activeKey={sortKey} dir={dir} onSort={toggle} className="px-4" />
                <SortableTh label="Seg" sortKey="segment" activeKey={sortKey} dir={dir} onSort={toggle} className="px-2" />
                <SortableTh label="Ville" sortKey="city" activeKey={sortKey} dir={dir} onSort={toggle} className="px-2" />
                <SortableTh label="Statut" sortKey="status" activeKey={sortKey} dir={dir} onSort={toggle} className="px-2" />
                <SortableTh label="Score" sortKey="score" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="px-2" />
                <th className="px-2 py-2 font-medium">Opportunité</th>
                <SortableTh label="CA YTD" sortKey="ca_ytd" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="px-4" />
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map((a) => {
                const opp = opportunityByAccount.get(a.id);
                return (
                  <tr
                    key={a.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted"
                    onClick={() => setSelectedAccount(a)}
                  >
                    <td className="px-4 py-2 font-medium text-foreground">
                      <span className="flex items-center gap-2">
                        {a.name}
                        <ScoreBadge score={computeTargetingScore(a).total} />
                      </span>
                    </td>
                    <td className="px-2 py-2"><SegmentBadge segment={a.segment} /></td>
                    <td className="px-2 py-2 text-muted-foreground">{a.city ?? "—"}</td>
                    <td className="px-2 py-2"><StatusBadge status={a.status} /></td>
                    <td className="px-2 py-2 text-right">{computeTargetingScore(a).total}/100</td>
                    <td className="px-2 py-2">
                      {opp ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                          style={{ backgroundColor: OPPORTUNITY_META[opp.type].color }}
                        >
                          {opp.label}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{formatEUR(a.ca_2026_ytd)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Aucun compte ne correspond à ces filtres.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Drawer fiche compte ── */}
      {selectedAccount && (
        <div className="fixed inset-y-0 right-0 z-30 w-96 overflow-y-auto border-l border-border bg-surface p-5 shadow-xl">
          <button onClick={() => setSelectedAccount(null)} className="mb-4 text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
          <div className="mb-3 flex items-center gap-2">
            <SegmentBadge segment={selectedAccount.segment} />
            <StatusBadge status={selectedAccount.status} />
          </div>
          <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            {selectedAccount.name}
            <ScoreBadge score={computeTargetingScore(selectedAccount).total} />
          </h3>
          <p className="mb-4 text-sm text-muted-foreground">
            {selectedAccount.city} {selectedAccount.postal_code}
          </p>
          <Row label="Objectif" value={formatNumber(selectedAccount.objectif_boites)} />
          <Row label="Réalisé" value={formatNumber(selectedAccount.realise_boites)} />
          <Row label="CA YTD" value={formatEUR(selectedAccount.ca_2026_ytd)} />
          <Row
            label="% Atteinte"
            value={formatPct(selectedAccount.objectif_boites
              ? (selectedAccount.realise_boites ?? 0) / selectedAccount.objectif_boites
              : null)}
          />
          {(() => {
            const opp = opportunityByAccount.get(selectedAccount.id);
            if (!opp) return null;
            const meta = OPPORTUNITY_META[opp.type];
            const isPlanned = planned.has(selectedAccount.id);
            return (
              <div className="mt-3 rounded-lg border p-3" style={{ borderColor: meta.color }}>
                <div className="flex items-center gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                    style={{ backgroundColor: meta.color }}
                  >
                    {meta.label}
                  </span>
                  <span className="text-xs font-medium text-foreground">{formatEUR(opp.value)}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{opp.reason}</p>
                <button
                  onClick={() => planNextMonth(selectedAccount)}
                  disabled={planning || isPlanned}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary-100 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-60"
                >
                  {planning ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : isPlanned ? (
                    <CheckCircle2 size={13} className="text-success" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  {isPlanned ? "Planifié — visible dans Pilotage" : "Planifier le mois prochain"}
                </button>
              </div>
            );
          })()}
          <Link
            href={`/comptes/${selectedAccount.id}`}
            className="mt-4 block rounded-lg bg-primary px-3 py-2 text-center text-sm font-medium text-white hover:bg-primary-600"
          >
            Ouvrir la fiche compte
          </Link>
        </div>
      )}
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
