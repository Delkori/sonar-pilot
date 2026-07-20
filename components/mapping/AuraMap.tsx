"use client";

import { useMemo, useState } from "react";
import * as d3geo from "d3-geo";
import { SegmentBadge, StatusBadge } from "@/components/ui/Badge";
import { formatEUR, formatNumber, formatPct } from "@/lib/utils";
import { detectOpportunities, OPPORTUNITY_META } from "@/lib/opportunities";
import { suggestMonthlyForecast } from "@/lib/forecast";
import { createClient } from "@/lib/supabase/client";
import type { Account, Segment, AccountStatus } from "@/types/database";
import Link from "next/link";
import { X, Sparkles, CheckCircle2, Loader2 } from "lucide-react";

interface DeptFeature {
  type: "Feature";
  properties: { code: string; nom: string };
  geometry: GeoJSON.Geometry;
}

const WIDTH = 720;
const HEIGHT = 720;

function ecartRatio(a: Account) {
  if (!a.objectif_boites) return null;
  return ((a.realise_boites ?? 0) - a.objectif_boites) / a.objectif_boites;
}

function deptColor(ratio: number | null) {
  if (ratio === null) return "#e2e8f0";
  if (ratio >= 0) return "#6366f1";
  if (ratio >= -0.25) return "#a5b4fc";
  if (ratio >= -0.5) return "#fcd34d";
  return "#fca5a5";
}

interface ProductRow {
  account_id: string;
  brand: string;
  qty_ordered_cy: number | null;
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

  const productsByAccount = useMemo(() => {
    const map = new Map<string, { brand: string; qty: number }[]>();
    for (const p of products) {
      if (!map.has(p.account_id)) map.set(p.account_id, []);
      map.get(p.account_id)!.push({ brand: p.brand, qty: p.qty_ordered_cy ?? 0 });
    }
    return map;
  }, [products]);
  const totalBrandCount = useMemo(() => new Set(products.map((p) => p.brand)).size, [products]);

  const opportunityByAccount = useMemo(() => {
    const opps = detectOpportunities(accounts, productsByAccount, totalBrandCount);
    return new Map(opps.map((o) => [o.account.id, o] as const));
  }, [accounts, productsByAccount, totalBrandCount]);

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
        boites_prevues: suggestion.boites_prevues,
        ca_prevu: suggestion.ca_prevu,
        note: opp ? `${opp.label} — ${opp.reason}` : suggestion.note,
      },
      { onConflict: "account_id,year,month" }
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
    () => d3geo.geoConicConformal().center([4.5, 45.4]).scale(9000).translate([WIDTH / 2, HEIGHT / 2]),
    []
  );
  const pathGen = useMemo(() => d3geo.geoPath(projection), [projection]);

  const deptStats = useMemo(() => {
    const map = new Map<string, { objectif: number; realise: number; count: number; ca: number }>();
    for (const a of accounts) {
      if (!a.department_code) continue;
      const cur = map.get(a.department_code) ?? { objectif: 0, realise: 0, count: 0, ca: 0 };
      cur.objectif += a.objectif_boites ?? 0;
      cur.realise += a.realise_boites ?? 0;
      cur.ca += a.ca_2026_ytd ?? 0;
      cur.count += 1;
      map.set(a.department_code, cur);
    }
    return map;
  }, [accounts]);

  const geolocated = filtered.filter((a) => a.latitude !== null && a.longitude !== null);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
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
              Réinitialiser le département
            </button>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 text-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Légende — écart</p>
          <LegendRow color="#6366f1" label="Objectif atteint" />
          <LegendRow color="#a5b4fc" label="Écart léger (0 à -25%)" />
          <LegendRow color="#fcd34d" label="Écart modéré (-25 à -50%)" />
          <LegendRow color="#fca5a5" label="Écart critique (< -50%)" />
          <LegendRow color="#e2e8f0" label="Pas de donnée" />
        </div>

        {selectedDept && deptStats.get(selectedDept) && (
          <div className="rounded-xl border border-border bg-surface p-4 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {geo.features.find((f) => f.properties.code === selectedDept)?.properties.nom}
            </p>
            <Row label="Comptes" value={formatNumber(deptStats.get(selectedDept)!.count)} />
            <Row label="Objectif" value={formatNumber(deptStats.get(selectedDept)!.objectif)} />
            <Row label="Réalisé" value={formatNumber(deptStats.get(selectedDept)!.realise)} />
            <Row label="CA YTD" value={formatEUR(deptStats.get(selectedDept)!.ca)} />
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full">
          {geo.features.map((f) => {
            const stats = deptStats.get(f.properties.code);
            const ratio = stats && stats.objectif > 0 ? (stats.realise - stats.objectif) / stats.objectif : null;
            return (
              <path
                key={f.properties.code}
                d={pathGen(f as unknown as d3geo.GeoPermissibleObjects) ?? ""}
                fill={deptColor(ratio)}
                stroke="#ffffff"
                strokeWidth={1.5}
                opacity={selectedDept && selectedDept !== f.properties.code ? 0.35 : 0.9}
                className="cursor-pointer transition-opacity hover:opacity-100"
                onClick={() => setSelectedDept(selectedDept === f.properties.code ? null : f.properties.code)}
              >
                <title>{f.properties.nom}</title>
              </path>
            );
          })}

          {geolocated.map((a) => {
            const coords = projection([a.longitude!, a.latitude!]);
            if (!coords) return null;
            const [x, y] = coords;
            const ratio = ecartRatio(a);
            const opp = opportunityByAccount.get(a.id);
            const r = a.segment === "A" ? 6 : a.segment === "B" ? 5 : 4;
            return (
              <g key={a.id} className="cursor-pointer" onClick={() => setSelectedAccount(a)}>
                {opp && (
                  <circle
                    cx={x}
                    cy={y}
                    r={r + 4}
                    fill="none"
                    stroke={OPPORTUNITY_META[opp.type].color}
                    strokeWidth={2}
                    opacity={0.85}
                  />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  fill={ratio !== null && ratio < -0.5 ? "#dc2626" : "#4338ca"}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                >
                  <title>{opp ? `${a.name} — ${opp.label}` : a.name}</title>
                </circle>
              </g>
            );
          })}
        </svg>
        {geolocated.length === 0 && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Aucun compte géocodé pour l&apos;instant — lancez le géocodage depuis l&apos;écran Import.
          </p>
        )}
      </div>

      {selectedAccount && (
        <div className="fixed inset-y-0 right-0 z-30 w-96 overflow-y-auto border-l border-border bg-surface p-5 shadow-xl">
          <button onClick={() => setSelectedAccount(null)} className="mb-4 text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
          <div className="mb-3 flex items-center gap-2">
            <SegmentBadge segment={selectedAccount.segment} />
            <StatusBadge status={selectedAccount.status} />
          </div>
          <h3 className="text-lg font-semibold text-foreground">{selectedAccount.name}</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            {selectedAccount.city} {selectedAccount.postal_code}
          </p>
          <Row label="Objectif" value={formatNumber(selectedAccount.objectif_boites)} />
          <Row label="Réalisé" value={formatNumber(selectedAccount.realise_boites)} />
          <Row label="CA YTD" value={formatEUR(selectedAccount.ca_2026_ytd)} />
          <Row
            label="% Atteinte"
            value={formatPct(selectedAccount.objectif_boites ? (selectedAccount.realise_boites ?? 0) / selectedAccount.objectif_boites : null)}
          />
          {selectedAccount.action_recommandee && (
            <div className="mt-3 rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-700">
              {selectedAccount.action_recommandee}
            </div>
          )}
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
