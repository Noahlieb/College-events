import type { DiscoveredItem, FetchContext, SourceAdapter } from "./types.js";
import { IngestionError } from "./types.js";

export interface IcalEvent {
  uid: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  url: string | null;
  dtstart: string | null; // raw ICS value, e.g. 20260826T180000Z or 20260826
  dtend: string | null;
}

/**
 * Minimal RFC 5545 VEVENT parser. Owl Central (Campus Labs/Engage) and most
 * university calendar systems expose a public .ics feed per organization or
 * campus-wide — this is preferred over HTML scraping per spec §9 because
 * it's a stable, structured format we don't have to reverse-engineer.
 * Deliberately dependency-free: ICS is simple enough that a small parser is
 * easier to reason about and test than pulling in a large library.
 */
export function parseIcs(ics: string): IcalEvent[] {
  const unfolded = ics.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, ""); // RFC5545 line unfolding
  const lines = unfolded.split("\n").filter(Boolean);

  const events: IcalEvent[] = [];
  let current: Partial<IcalEvent> | null = null;

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      current = {};
      continue;
    }
    if (line.startsWith("END:VEVENT")) {
      if (current) {
        events.push({
          uid: current.uid ?? crypto.randomUUID(),
          summary: current.summary ?? null,
          description: current.description ?? null,
          location: current.location ?? null,
          url: current.url ?? null,
          dtstart: current.dtstart ?? null,
          dtend: current.dtend ?? null,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const separatorIdx = line.indexOf(":");
    if (separatorIdx === -1) continue;
    const rawKey = line.slice(0, separatorIdx);
    const value = line.slice(separatorIdx + 1).trim();
    const key = rawKey.split(";")[0]!.toUpperCase(); // strip params like ;TZID=...

    switch (key) {
      case "UID":
        current.uid = value;
        break;
      case "SUMMARY":
        current.summary = unescapeIcsText(value);
        break;
      case "DESCRIPTION":
        current.description = unescapeIcsText(value);
        break;
      case "LOCATION":
        current.location = unescapeIcsText(value);
        break;
      case "URL":
        current.url = value;
        break;
      case "DTSTART":
        current.dtstart = value;
        break;
      case "DTEND":
        current.dtend = value;
        break;
    }
  }

  return events;
}

function unescapeIcsText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/** Converts an ICS DTSTART/DTEND value ("20260826T180000Z" or "20260826") to ISO 8601. */
export function icsDateToIso(value: string | null): string | null {
  if (!value) return null;
  const utcMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (utcMatch) {
    const [, y, mo, d, h, mi, s] = utcMatch;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
  }
  const localMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (localMatch) {
    const [, y, mo, d, h, mi, s] = localMatch;
    // No explicit offset/TZID resolved — treat as naive local time; callers
    // that need a specific school timezone should re-parse with core's
    // parseEventDate once this raw text reaches AI extraction.
    return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
  }
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    return `${y}-${mo}-${d}T00:00:00.000Z`;
  }
  return null;
}

async function fetchIcsEvents(url: string, fetchImpl: typeof fetch): Promise<IcalEvent[]> {
  const res = await fetchImpl(url, { headers: { Accept: "text/calendar, text/plain" } });
  if (!res.ok) {
    throw new Error(`Failed to fetch ICS feed ${url}: HTTP ${res.status}`);
  }
  return parseIcs(await res.text());
}

function toDiscoveredItem(event: IcalEvent): DiscoveredItem {
  const start = icsDateToIso(event.dtstart);
  const end = icsDateToIso(event.dtend);
  const textParts = [
    event.summary,
    event.location ? `Location: ${event.location}` : null,
    start ? `Start: ${start}` : null,
    end ? `End: ${end}` : null,
    event.description,
  ].filter(Boolean);

  return {
    externalId: event.uid,
    sourceUrl: event.url,
    rawText: textParts.join("\n"),
    mediaUrl: null,
    publishedAt: null, // ICS feeds don't reliably expose a "posted at" timestamp
    rawMetadata: { dtstart: event.dtstart, dtend: event.dtend, location: event.location },
  };
}

/** Owl Central / Campus Labs Engage public event feed (preferred structured source, spec §9). */
export const owlCentralAdapter: SourceAdapter = {
  supportedTypes: ["owl_central"],
  async fetchNew(ctx: FetchContext): Promise<DiscoveredItem[]> {
    if (!ctx.source.url) {
      throw new IngestionError("Owl Central source has no URL configured", ctx.source.id);
    }
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const events = await fetchIcsEvents(ctx.source.url, fetchImpl);
    const items = events.map(toDiscoveredItem);
    return ctx.maxItems ? items.slice(0, ctx.maxItems) : items;
  },
};

/** Generic university calendar / venue iCal feed. */
export const icalAdapter: SourceAdapter = {
  supportedTypes: ["ical", "university_calendar"],
  async fetchNew(ctx: FetchContext): Promise<DiscoveredItem[]> {
    if (!ctx.source.url) {
      throw new IngestionError("iCal source has no URL configured", ctx.source.id);
    }
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const events = await fetchIcsEvents(ctx.source.url, fetchImpl);
    const items = events.map(toDiscoveredItem);
    return ctx.maxItems ? items.slice(0, ctx.maxItems) : items;
  },
};
