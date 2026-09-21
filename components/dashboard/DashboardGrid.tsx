"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  EyeOff,
  GripVertical,
  LayoutGrid,
  Loader2,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import {
  applyPreset,
  DEFAULT_LAYOUT,
  GROUP_LABEL,
  moveWidget,
  moveWidgetTo,
  PRESETS,
  sameLayout,
  setWidgetSize,
  setWidgetVisible,
  WIDGET_BY_ID,
  type DashboardLayout,
  type WidgetId,
} from "@/lib/dashboard-layout";
import type { SaveStatus } from "@/components/dashboard/useDashboardLayout";

/**
 * Grille du dashboard : chaque widget visible occupe une demi-largeur ou
 * la largeur entière. En mode réglage, un panneau liste tous les widgets
 * (cocher pour afficher, flèches pour ordonner, ½ / 1 pour la largeur,
 * trois préréglages), et les widgets de la grille se glissent-déposent.
 */
export function DashboardGrid({
  layout,
  onChange,
  render,
  status,
}: {
  layout: DashboardLayout;
  onChange: (next: DashboardLayout) => void;
  /** `null` quand le widget n'a rien à montrer avec les données présentes. */
  render: (id: WidgetId) => ReactNode | null;
  status: SaveStatus;
}) {
  const [customizing, setCustomizing] = useState(false);
  const [dragId, setDragId] = useState<WidgetId | null>(null);

  const isDefault = sameLayout(layout, DEFAULT_LAYOUT);
  const visible = layout.widgets.filter((w) => w.visible);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground" aria-live="polite">
          {status === "saving" && (
            <span className="flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Enregistrement…</span>
          )}
          {status === "saved" && (
            <span className="flex items-center gap-1 text-success"><Check size={12} /> Mise en page enregistrée</span>
          )}
          {status === "error" && (
            <span className="flex items-center gap-1 text-warning"><TriangleAlert size={12} /> Mise en page non enregistrée — elle sera perdue au rechargement</span>
          )}
        </span>
        {customizing && (
          <Button size="sm" variant="ghost" disabled={isDefault} onClick={() => onChange(DEFAULT_LAYOUT)} title="Revenir à la mise en page proposée">
            <RotateCcw size={13} /> Réinitialiser
          </Button>
        )}
        <Button size="sm" variant={customizing ? "primary" : "secondary"} onClick={() => setCustomizing((v) => !v)}>
          <LayoutGrid size={13} />
          {customizing ? "Terminer" : "Choisir les widgets"}
        </Button>
      </div>

      {customizing && (
        <Card>
          <CardHeader>
            <CardTitle>Ce que le dashboard affiche</CardTitle>
            <CardDescription>
              Cochez ce que vous voulez voir, ordonnez avec les flèches ou en glissant les widgets ci-dessous, choisissez leur
              largeur. Les réglages sont enregistrés pour vous, sur tous vos appareils.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Préréglages :</span>
              {PRESETS.map((p) => (
                <Button key={p.key} size="sm" title={p.description} onClick={() => onChange(applyPreset(layout, p.key))}>
                  {p.label}
                </Button>
              ))}
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {layout.widgets.map((w, index) => {
                const meta = WIDGET_BY_ID.get(w.id)!;
                const available = render(w.id) !== null;
                return (
                  <li key={w.id} className={cn("flex flex-wrap items-center gap-3 px-3 py-2", !available && "opacity-60")}>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={w.visible}
                        onChange={(e) => onChange(setWidgetVisible(layout, w.id, e.target.checked))}
                        className="h-4 w-4 accent-primary"
                        aria-label={`Afficher ${meta.label}`}
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                          {meta.label}
                          <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {GROUP_LABEL[meta.group]}
                          </span>
                          {!available && <span className="text-[10px] text-muted-foreground">rien à afficher avec les données actuelles</span>}
                        </span>
                        <span className="block text-xs text-muted-foreground">{meta.description}</span>
                      </span>
                    </label>
                    <div className="flex items-center gap-1">
                      <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Largeur">
                        {(["half", "full"] as const).map((size) => (
                          <button
                            key={size}
                            type="button"
                            onClick={() => onChange(setWidgetSize(layout, w.id, size))}
                            title={size === "half" ? "Demi-largeur" : "Pleine largeur"}
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[11px] font-medium",
                              w.size === size ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {size === "half" ? "½" : "1"}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => onChange(moveWidget(layout, w.id, -1))}
                        disabled={index === 0}
                        aria-label="Monter"
                        className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onChange(moveWidget(layout, w.id, 1))}
                        disabled={index === layout.widgets.length - 1}
                        aria-label="Descendre"
                        className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {visible.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Aucun widget affiché — choisissez-en dans « Choisir les widgets ».
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {visible.map((w) => {
          const node = render(w.id);
          if (node === null) return null;
          const meta = WIDGET_BY_ID.get(w.id)!;
          return (
            <div
              key={w.id}
              draggable={customizing}
              onDragStart={() => setDragId(w.id)}
              onDragOver={(e) => {
                if (customizing) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) onChange(moveWidgetTo(layout, dragId, w.id));
                setDragId(null);
              }}
              className={cn(
                w.size === "full" && "lg:col-span-2",
                customizing && "rounded-xl border-2 border-dashed border-primary-200 bg-primary-50/30 p-3 transition-colors hover:border-primary-400",
                customizing && dragId === w.id && "opacity-50"
              )}
            >
              {customizing && (
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary-700">
                  <GripVertical size={14} className="cursor-grab active:cursor-grabbing" />
                  <span className="flex-1">{meta.label}</span>
                  <button
                    type="button"
                    onClick={() => onChange(setWidgetSize(layout, w.id, w.size === "full" ? "half" : "full"))}
                    className="rounded border border-primary-200 px-1.5 py-0.5 text-[11px] hover:bg-primary-50"
                    title={w.size === "full" ? "Passer en demi-largeur" : "Passer en pleine largeur"}
                  >
                    {w.size === "full" ? "½" : "1"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(setWidgetVisible(layout, w.id, false))}
                    className="flex items-center gap-1 rounded border border-primary-200 px-1.5 py-0.5 text-[11px] hover:bg-primary-50"
                    title="Masquer ce widget"
                  >
                    <EyeOff size={12} /> Masquer
                  </button>
                </div>
              )}
              {node}
            </div>
          );
        })}
      </div>
    </div>
  );
}
