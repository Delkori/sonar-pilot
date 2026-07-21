export interface IcsEvent {
  uid: string;
  title: string;
  description?: string;
  date: string; // YYYY-MM-DD, événement "journée entière"
  url?: string;
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function dateToIcsDate(date: string): string {
  return date.replace(/-/g, "");
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
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}@sonar-pilot`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${dateToIcsDate(ev.date)}`,
      `SUMMARY:${escapeIcsText(ev.title)}`
    );
    if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    if (ev.url) lines.push(`URL:${ev.url}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
