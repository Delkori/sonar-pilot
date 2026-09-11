import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildIcsCalendar } from "@/lib/ics";

const calendrier = (events: Parameters<typeof buildIcsCalendar>[0]) =>
  buildIcsCalendar(events, "Sonar Pilot");

describe("buildIcsCalendar", () => {
  test("produit une enveloppe VCALENDAR complète", () => {
    const ics = calendrier([]);
    assert.ok(ics.startsWith("BEGIN:VCALENDAR"));
    assert.ok(ics.trimEnd().endsWith("END:VCALENDAR"));
    assert.ok(ics.includes("VERSION:2.0"));
  });

  test("sépare les lignes par CRLF, comme l'exige la RFC 5545", () => {
    // Apple Calendar et Google Agenda rejettent un flux en LF seul.
    const ics = calendrier([{ uid: "a", title: "Visite", date: "2026-07-01" }]);
    assert.ok(ics.includes("\r\n"));
    assert.ok(!/[^\r]\n/.test(ics), "aucun LF isolé");
  });

  test("écrit un événement journée entière à partir d'une date seule", () => {
    const ics = calendrier([{ uid: "a", title: "Relance", date: "2026-07-01" }]);
    assert.ok(ics.includes("DTSTART;VALUE=DATE:20260701"));
  });

  test("écrit un créneau horaire quand start et end sont fournis", () => {
    const ics = calendrier([
      { uid: "b", title: "Visite", start: "2026-07-01T08:30:00.000Z", end: "2026-07-01T09:30:00.000Z" },
    ]);
    assert.ok(ics.includes("DTSTART:20260701T083000Z"));
    assert.ok(ics.includes("DTEND:20260701T093000Z"));
  });

  test("échappe les caractères qui structurent le format", () => {
    // Une virgule ou un point-virgule non échappé coupe la propriété en deux
    // et casse l'import du fichier entier, pas seulement de l'événement.
    const ics = calendrier([
      { uid: "c", title: "Dr Martin, Lyon; suivi", description: "ligne 1\nligne 2", date: "2026-07-01" },
    ]);
    assert.ok(ics.includes("SUMMARY:Dr Martin\\, Lyon\\; suivi"));
    assert.ok(ics.includes("DESCRIPTION:ligne 1\\nligne 2"));
  });

  test("donne à chaque événement un UID stable et distinct", () => {
    const ics = calendrier([
      { uid: "action-1", title: "A", date: "2026-07-01" },
      { uid: "action-2", title: "B", date: "2026-07-02" },
    ]);
    const uids = [...ics.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]);
    assert.equal(new Set(uids).size, 2, "des UID identiques feraient fusionner les événements");
  });

  test("ouvre et ferme autant de VEVENT qu'il y a d'événements", () => {
    const ics = calendrier([
      { uid: "a", title: "A", date: "2026-07-01" },
      { uid: "b", title: "B", date: "2026-07-02" },
    ]);
    assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
    assert.equal((ics.match(/END:VEVENT/g) ?? []).length, 2);
  });
});

describe("pliage des lignes (RFC 5545 §3.1)", () => {
  const lignes = (ics: string) => ics.split("\r\n");

  test("aucune ligne ne dépasse 75 octets", () => {
    const ics = calendrier([
      {
        uid: "long",
        title: "Visite — Cabinet de dermatologie esthétique du Grand Lyon Part-Dieu",
        description:
          "Prévisionnel : 24 boîtes · 3 450 € — Dernière commande : 14/05/2026 — " +
          "Préparer la présentation de la gamme complète et le point sur les remises Pro+.",
        date: "2026-07-01",
      },
    ]);
    for (const ligne of lignes(ics)) {
      assert.ok(Buffer.byteLength(ligne, "utf8") <= 75, `ligne trop longue : ${ligne.slice(0, 40)}…`);
    }
  });

  test("les continuations commencent par une espace", () => {
    const ics = calendrier([{ uid: "l", title: "A".repeat(200), date: "2026-07-01" }]);
    const suite = lignes(ics).filter((l) => l.startsWith(" "));
    assert.ok(suite.length > 0);
  });

  test("le dépliage restitue le texte d'origine", () => {
    const titre = "Rendez-vous très détaillé — accentué, avec des caractères multi-octets (é, ü, ≥)";
    const ics = calendrier([{ uid: "u", title: titre, date: "2026-07-01" }]);
    const deplie = ics.replace(/\r\n /g, "");
    assert.ok(deplie.includes(`SUMMARY:${titre.replace(/,/g, "\\,")}`));
  });

  test("laisse intactes les lignes déjà assez courtes", () => {
    const ics = calendrier([{ uid: "court", title: "Appel", date: "2026-07-01" }]);
    assert.ok(ics.includes("\r\nSUMMARY:Appel\r\n"));
  });
});
