/**
 * Mise en page du dashboard : ce que l'utilisateur choisit d'y voir, dans
 * quel ordre et à quelle largeur. Le registre décrit chaque widget une
 * fois ; la mise en page n'est qu'une liste (id, visible, taille), stockée
 * par utilisateur (`user_preferences.dashboard_layout`) et normalisée à la
 * lecture — un widget retiré du code disparaît, un widget nouveau apparaît
 * masqué, jamais d'écran cassé par une préférence ancienne.
 */

export type WidgetId =
  | "kpis"
  | "semaine"
  | "chances"
  | "priority"
  | "overdue"
  | "lost"
  | "quick-actions"
  | "monthly-chart"
  | "annual-objective"
  | "tiers"
  | "top-flop"
  | "movers"
  | "secondary-kpis"
  | "recurrence"
  | "management"
  | "action-distribution"
  | "department"
  | "products"
  | "competitor";

export type WidgetSize = "half" | "full";
export type WidgetGroup = "agir" | "piloter" | "comprendre" | "marche";

export const GROUP_LABEL: Record<WidgetGroup, string> = {
  agir: "Agir cette semaine",
  piloter: "Piloter les chiffres",
  comprendre: "Comprendre le portefeuille",
  marche: "Marché",
};

export interface WidgetMeta {
  id: WidgetId;
  label: string;
  description: string;
  group: WidgetGroup;
  defaultSize: WidgetSize;
}

export const WIDGETS: readonly WidgetMeta[] = [
  { id: "kpis", label: "Chiffres clés", description: "CA réalisé et rythme vs N-1, objectif, écart, potentiel à capter.", group: "piloter", defaultSize: "full" },
  { id: "semaine", label: "Cette semaine", description: "Rendez-vous des 7 prochains jours et prévisions du mois sans rendez-vous.", group: "agir", defaultSize: "half" },
  { id: "chances", label: "Chances de commande", description: "Les comptes les plus susceptibles de commander dans les 3 mois.", group: "agir", defaultSize: "half" },
  { id: "priority", label: "Comptes prioritaires", description: "Score de ciblage le plus élevé, prévisionnel en un clic.", group: "agir", defaultSize: "full" },
  { id: "overdue", label: "Relances en retard", description: "Comptes actifs sans appel depuis plus de 60 jours.", group: "agir", defaultSize: "half" },
  { id: "lost", label: "Comptes perdus", description: "À regagner, du plus gros CA au plus petit.", group: "agir", defaultSize: "half" },
  { id: "quick-actions", label: "Saisie rapide", description: "Commentaire, action, relance ou offre sur un compte.", group: "agir", defaultSize: "half" },
  { id: "monthly-chart", label: "Courbe mensuelle", description: "CA, objectif et prévisionnel mois par mois.", group: "piloter", defaultSize: "full" },
  { id: "annual-objective", label: "Objectif annuel", description: "Courbe d'atterrissage : cumul réalisé contre cumul objectif.", group: "piloter", defaultSize: "half" },
  { id: "tiers", label: "Premium / Pro / Pro+", description: "Comptes sous contrat : CA contre potentiel.", group: "piloter", defaultSize: "full" },
  { id: "top-flop", label: "Top 10 / Flop 10 clients", description: "CA de l'exercice en cours contre l'exercice clos.", group: "piloter", defaultSize: "full" },
  { id: "movers", label: "Croissance et déclin", description: "Les cinq plus fortes évolutions entre les deux derniers exercices clos.", group: "piloter", defaultSize: "full" },
  { id: "secondary-kpis", label: "Indicateurs secondaires", description: "CA moyen par compte actif, concentration segment A, actifs, à risque.", group: "piloter", defaultSize: "full" },
  { id: "recurrence", label: "Récurrence des commandes", description: "Répartition du portefeuille par cadence.", group: "comprendre", defaultSize: "half" },
  { id: "management", label: "Segments", description: "Comptes et CA par segment.", group: "comprendre", defaultSize: "half" },
  { id: "action-distribution", label: "Actions recommandées", description: "Répartition des comptes par action du score de ciblage.", group: "comprendre", defaultSize: "full" },
  { id: "department", label: "Départements", description: "Synthèse départementale, cliquable pour filtrer.", group: "comprendre", defaultSize: "full" },
  { id: "products", label: "Ventes par produit", description: "Comparatif des ventes par référence contre l'année précédente.", group: "comprendre", defaultSize: "full" },
  { id: "competitor", label: "Sponsoring des concurrents", description: "Investissement des laboratoires sur le secteur (Transparence Santé).", group: "marche", defaultSize: "half" },
];

export const WIDGET_BY_ID: ReadonlyMap<WidgetId, WidgetMeta> = new Map(WIDGETS.map((w) => [w.id, w] as const));

export interface WidgetSetting {
  id: WidgetId;
  visible: boolean;
  size: WidgetSize;
}

export interface DashboardLayout {
  version: 1;
  widgets: WidgetSetting[];
}

/** Ce qu'un responsable de secteur voit en arrivant, avant tout réglage. */
const DEFAULT_VISIBLE: WidgetId[] = [
  "kpis",
  "semaine",
  "chances",
  "monthly-chart",
  "priority",
  "overdue",
  "lost",
  "annual-objective",
  "recurrence",
  "quick-actions",
  "tiers",
];

function settingFor(id: WidgetId, visible: boolean): WidgetSetting {
  return { id, visible, size: WIDGET_BY_ID.get(id)!.defaultSize };
}

export const DEFAULT_LAYOUT: DashboardLayout = {
  version: 1,
  widgets: [
    ...DEFAULT_VISIBLE.map((id) => settingFor(id, true)),
    ...WIDGETS.filter((w) => !DEFAULT_VISIBLE.includes(w.id)).map((w) => settingFor(w.id, false)),
  ],
};

export type PresetKey = "terrain" | "pilotage" | "complet";

export interface Preset {
  key: PresetKey;
  label: string;
  description: string;
  /** Widgets affichés, dans cet ordre ; les autres passent masqués. */
  widgets: WidgetId[];
}

export const PRESETS: readonly Preset[] = [
  {
    key: "terrain",
    label: "Terrain",
    description: "Ce qu'il y a à faire : la semaine, les chances, les prioritaires, les relances.",
    widgets: ["kpis", "semaine", "chances", "priority", "overdue", "lost", "quick-actions"],
  },
  {
    key: "pilotage",
    label: "Pilotage",
    description: "Les chiffres : courbe, objectif, contrats, top et flop, évolutions.",
    widgets: ["kpis", "monthly-chart", "annual-objective", "tiers", "top-flop", "movers", "recurrence", "department", "secondary-kpis"],
  },
  {
    key: "complet",
    label: "Complet",
    description: "Tous les widgets.",
    widgets: [...DEFAULT_VISIBLE, ...WIDGETS.filter((w) => !DEFAULT_VISIBLE.includes(w.id)).map((w) => w.id)],
  },
];

const isWidgetId = (v: unknown): v is WidgetId => typeof v === "string" && WIDGET_BY_ID.has(v as WidgetId);
const isSize = (v: unknown): v is WidgetSize => v === "half" || v === "full";

/**
 * Rend exploitable n'importe quelle valeur stockée : préférence absente ou
 * corrompue → mise en page par défaut ; ids inconnus ignorés ; widgets
 * apparus depuis ajoutés à la fin, masqués — l'utilisateur les découvre
 * dans le panneau, ils ne s'imposent pas.
 */
export function normalizeLayout(raw: unknown): DashboardLayout {
  if (!raw || typeof raw !== "object") return DEFAULT_LAYOUT;
  const widgetsRaw = (raw as { widgets?: unknown }).widgets;
  if (!Array.isArray(widgetsRaw)) return DEFAULT_LAYOUT;
  const seen = new Set<WidgetId>();
  const widgets: WidgetSetting[] = [];
  for (const item of widgetsRaw) {
    if (!item || typeof item !== "object") continue;
    const { id, visible, size } = item as { id?: unknown; visible?: unknown; size?: unknown };
    if (!isWidgetId(id) || seen.has(id)) continue;
    seen.add(id);
    widgets.push({ id, visible: visible !== false, size: isSize(size) ? size : WIDGET_BY_ID.get(id)!.defaultSize });
  }
  if (widgets.length === 0) return DEFAULT_LAYOUT;
  for (const w of WIDGETS) if (!seen.has(w.id)) widgets.push(settingFor(w.id, false));
  return { version: 1, widgets };
}

export function setWidgetVisible(layout: DashboardLayout, id: WidgetId, visible: boolean): DashboardLayout {
  return { ...layout, widgets: layout.widgets.map((w) => (w.id === id ? { ...w, visible } : w)) };
}

export function setWidgetSize(layout: DashboardLayout, id: WidgetId, size: WidgetSize): DashboardLayout {
  return { ...layout, widgets: layout.widgets.map((w) => (w.id === id ? { ...w, size } : w)) };
}

/** Déplace un widget d'un cran (−1 = vers le haut, +1 = vers le bas). */
export function moveWidget(layout: DashboardLayout, id: WidgetId, delta: -1 | 1): DashboardLayout {
  const widgets = [...layout.widgets];
  const from = widgets.findIndex((w) => w.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= widgets.length) return layout;
  [widgets[from], widgets[to]] = [widgets[to], widgets[from]];
  return { ...layout, widgets };
}

/** Place `id` à la position de `targetId` (glisser-déposer). */
export function moveWidgetTo(layout: DashboardLayout, id: WidgetId, targetId: WidgetId): DashboardLayout {
  if (id === targetId) return layout;
  const widgets = [...layout.widgets];
  const from = widgets.findIndex((w) => w.id === id);
  const to = widgets.findIndex((w) => w.id === targetId);
  if (from < 0 || to < 0) return layout;
  const [moved] = widgets.splice(from, 1);
  widgets.splice(to, 0, moved);
  return { ...layout, widgets };
}

/** Les widgets du préréglage, visibles et dans son ordre ; les autres masqués, dans leur ordre actuel. */
export function applyPreset(layout: DashboardLayout, key: PresetKey): DashboardLayout {
  const preset = PRESETS.find((p) => p.key === key);
  if (!preset) return layout;
  const byId = new Map(layout.widgets.map((w) => [w.id, w] as const));
  const shown = preset.widgets.map((id) => ({ ...(byId.get(id) ?? settingFor(id, true)), visible: true }));
  const hidden = layout.widgets.filter((w) => !preset.widgets.includes(w.id)).map((w) => ({ ...w, visible: false }));
  return { version: 1, widgets: [...shown, ...hidden] };
}

export function sameLayout(a: DashboardLayout, b: DashboardLayout): boolean {
  return (
    a.widgets.length === b.widgets.length &&
    a.widgets.every((w, i) => w.id === b.widgets[i].id && w.visible === b.widgets[i].visible && w.size === b.widgets[i].size)
  );
}
