export interface IcsEvent {
  uid: string;
  title: string;
  description?: string;
  /** Événement "journée entière" — format YYYY-MM-DD. Ignoré si start/end fournis. */
  date?: string;
  /** Événement avec horaire précis — ISO 8601 (avec heure). */
  start?: string;
  end?: string;
  url?: string;
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function dateToIcsDate(date: string): string {
  return date.replace(/-/g, "");
}

function dateTimeToIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

/**
 * Pliage des lignes à 75 octets (RFC 5545 §3.1) : une ligne plus longue doit
 * être coupée et la suite préfixée d'une espace. La description d'un
 * événement de planning concatène note, prévisionnel et dernière commande —
 * elle dépasse donc régulièrement la limite. Les parseurs tolérants s'en
 * accommodent, les stricts rejettent le flux entier, pas seulement la ligne.
 *
 * Le découpage compte des OCTETS, pas des caractères : couper au milieu
 * d'une séquence UTF-8 (un « é », une puce) produirait un flux invalide.
 */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let start = 0;
  // 75 octets pour la première ligne, 74 pour les suivantes (l'espace de
  // continuation compte dans la limite).
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Recule jusqu'au début d'un caractère complet (un octet de continuation
    // UTF-8 vaut 10xxxxxx).
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74;
  }
  return chunks.join("\r\n ");
}

/** Construit un flux .ics minimal, compatible Apple Calendar (abonnement). */
export function buildIcsCalendar(events: IcsEvent[], calendarName: string): string {
  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sonar Pilot//Calendrier//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    "X-WR-TIMEZONE:Europe/Paris",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];

  for (const ev of events) {
    lines.push("BEGIN:VEVENT", `UID:${ev.uid}@sonar-pilot`, `DTSTAMP:${now}`);
    if (ev.start && ev.end) {
      lines.push(`DTSTART:${dateTimeToIcsUtc(ev.start)}`, `DTEND:${dateTimeToIcsUtc(ev.end)}`);
    } else if (ev.date) {
      lines.push(`DTSTART;VALUE=DATE:${dateToIcsDate(ev.date)}`);
    }
    lines.push(`SUMMARY:${escapeIcsText(ev.title)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    if (ev.url) lines.push(`URL:${ev.url}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n");
}
