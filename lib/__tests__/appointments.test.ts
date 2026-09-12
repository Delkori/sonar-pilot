import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appointmentKey, appointmentsByAccountMonth, parisDateParts } from "@/lib/appointments";
import { monthIndex } from "@/lib/dates";

describe("appointmentsByAccountMonth", () => {
  it("regroupe visites et appels par compte et par mois, triés par jour", () => {
    const map = appointmentsByAccountMonth([
      { account_id: "a", type: "visite", start_at: "2026-09-18T08:00:00.000Z", confirmed: true },
      { account_id: "a", type: "appel", start_at: "2026-09-03T14:00:00.000Z", confirmed: false },
      { account_id: "a", type: "visite", start_at: "2026-10-01T08:00:00.000Z", confirmed: false },
      { account_id: "b", type: "visite_prospect", start_at: "2026-09-10T08:00:00.000Z", confirmed: false },
    ]);
    const sept = map.get(appointmentKey("a", monthIndex(2026, 9)));
    assert.deepEqual(
      sept?.map((r) => [r.type, r.day]),
      [
        ["appel", 3],
        ["visite", 18],
      ]
    );
    assert.equal(map.get(appointmentKey("a", monthIndex(2026, 10)))?.length, 1);
    assert.equal(map.get(appointmentKey("b", monthIndex(2026, 9)))?.[0].type, "visite_prospect");
  });

  it("ignore le temps administratif et les événements sans compte", () => {
    const map = appointmentsByAccountMonth([
      { account_id: "a", type: "admin", start_at: "2026-09-18T08:00:00.000Z", confirmed: false },
      { account_id: null, type: "visite", start_at: "2026-09-18T08:00:00.000Z", confirmed: false },
    ]);
    assert.equal(map.size, 0);
  });

  it("rattache l'événement au mois de Paris, pas au mois UTC", () => {
    // 23 h 30 UTC le 30 septembre = 1 h 30 le 1er octobre à Paris (été).
    assert.deepEqual(parisDateParts("2026-09-30T23:30:00.000Z"), { year: 2026, month: 10, day: 1 });
    const map = appointmentsByAccountMonth([
      { account_id: "a", type: "visite", start_at: "2026-09-30T23:30:00.000Z", confirmed: false },
    ]);
    assert.ok(map.has(appointmentKey("a", monthIndex(2026, 10))));
    assert.ok(!map.has(appointmentKey("a", monthIndex(2026, 9))));
  });

  it("ignore une date illisible plutôt que de planter", () => {
    const map = appointmentsByAccountMonth([{ account_id: "a", type: "visite", start_at: "n/a", confirmed: false }]);
    assert.equal(map.size, 0);
  });
});
