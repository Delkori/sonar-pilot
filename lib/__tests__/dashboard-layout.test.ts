import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  applyPreset,
  DEFAULT_LAYOUT,
  moveWidget,
  moveWidgetTo,
  normalizeLayout,
  PRESETS,
  sameLayout,
  setWidgetSize,
  setWidgetVisible,
  WIDGETS,
} from "@/lib/dashboard-layout";

describe("mise en page du dashboard", () => {
  test("la mise en page par défaut couvre chaque widget une fois", () => {
    const ids = DEFAULT_LAYOUT.widgets.map((w) => w.id);
    assert.equal(new Set(ids).size, WIDGETS.length);
    assert.equal(ids.length, WIDGETS.length);
    assert.equal(DEFAULT_LAYOUT.widgets[0].id, "kpis");
  });

  test("chaque préréglage ne cite que des widgets connus, sans doublon", () => {
    for (const p of PRESETS) {
      assert.equal(new Set(p.widgets).size, p.widgets.length, p.key);
      for (const id of p.widgets) assert.ok(WIDGETS.some((w) => w.id === id), `${p.key} : ${id}`);
    }
  });

  test("normalise une préférence absente, corrompue ou vide vers le défaut", () => {
    assert.ok(sameLayout(normalizeLayout(null), DEFAULT_LAYOUT));
    assert.ok(sameLayout(normalizeLayout("n'importe quoi"), DEFAULT_LAYOUT));
    assert.ok(sameLayout(normalizeLayout({ widgets: [] }), DEFAULT_LAYOUT));
    assert.ok(sameLayout(normalizeLayout({ widgets: [{ id: "inconnu" }] }), DEFAULT_LAYOUT));
  });

  test("ignore les ids inconnus et les doublons, ajoute les widgets manquants masqués", () => {
    const layout = normalizeLayout({
      widgets: [
        { id: "chances", visible: true, size: "full" },
        { id: "ancien-widget", visible: true },
        { id: "chances", visible: false },
        { id: "kpis", size: "bizarre" },
      ],
    });
    assert.deepEqual(layout.widgets.slice(0, 2), [
      { id: "chances", visible: true, size: "full" },
      { id: "kpis", visible: true, size: "full" },
    ]);
    assert.equal(layout.widgets.length, WIDGETS.length);
    assert.ok(layout.widgets.slice(2).every((w) => !w.visible), "les widgets non cités arrivent masqués");
  });

  test("afficher, masquer, redimensionner, déplacer", () => {
    let layout = setWidgetVisible(DEFAULT_LAYOUT, "kpis", false);
    assert.equal(layout.widgets.find((w) => w.id === "kpis")?.visible, false);
    layout = setWidgetSize(layout, "semaine", "full");
    assert.equal(layout.widgets.find((w) => w.id === "semaine")?.size, "full");
    layout = moveWidget(layout, "kpis", 1);
    assert.equal(layout.widgets[1].id, "kpis");
    assert.equal(moveWidget(layout, "kpis", -1).widgets[0].id, "kpis");
    assert.ok(sameLayout(moveWidget(DEFAULT_LAYOUT, "kpis", -1), DEFAULT_LAYOUT), "pas de sortie de liste");
    const last = DEFAULT_LAYOUT.widgets[DEFAULT_LAYOUT.widgets.length - 1].id;
    assert.equal(moveWidgetTo(DEFAULT_LAYOUT, last, "kpis").widgets[0].id, last);
  });

  test("un préréglage affiche ses widgets dans son ordre et masque les autres", () => {
    const layout = applyPreset(setWidgetSize(DEFAULT_LAYOUT, "chances", "full"), "terrain");
    const terrain = PRESETS.find((p) => p.key === "terrain")!;
    assert.deepEqual(layout.widgets.slice(0, terrain.widgets.length).map((w) => w.id), terrain.widgets);
    assert.ok(layout.widgets.slice(0, terrain.widgets.length).every((w) => w.visible));
    assert.ok(layout.widgets.slice(terrain.widgets.length).every((w) => !w.visible));
    assert.equal(layout.widgets.find((w) => w.id === "chances")?.size, "full", "la taille choisie est conservée");
    assert.equal(layout.widgets.length, WIDGETS.length);
  });
});
