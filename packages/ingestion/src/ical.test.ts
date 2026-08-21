import { describe, expect, it } from "vitest";
import { icsDateToIso, owlCentralAdapter, parseIcs } from "./ical.js";

const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Owl Central//Engage//EN
BEGIN:VEVENT
UID:owlcentral-evt-88213
SUMMARY:Sunset Yoga on the Green
DESCRIPTION:Free\\, mats provided while supplies last.
LOCATION:Recreation Green
DTSTART:20260826T220000Z
DTEND:20260826T230000Z
URL:https://fau.campuslabs.com/engage/event/88213
END:VEVENT
BEGIN:VEVENT
UID:owlcentral-evt-88214
SUMMARY:Career Fair
DTSTART:20260826T150000Z
DTEND:20260826T190000Z
END:VEVENT
END:VCALENDAR`;

describe("parseIcs", () => {
  it("parses multiple VEVENT blocks with unescaped text fields", () => {
    const events = parseIcs(SAMPLE_ICS);
    expect(events).toHaveLength(2);
    expect(events[0]!.summary).toBe("Sunset Yoga on the Green");
    expect(events[0]!.description).toBe("Free, mats provided while supplies last.");
    expect(events[0]!.location).toBe("Recreation Green");
    expect(events[1]!.uid).toBe("owlcentral-evt-88214");
  });
});

describe("icsDateToIso", () => {
  it("converts a UTC ICS timestamp to ISO", () => {
    expect(icsDateToIso("20260826T220000Z")).toBe("2026-08-26T22:00:00.000Z");
  });

  it("converts a date-only value to midnight ISO", () => {
    expect(icsDateToIso("20260826")).toBe("2026-08-26T00:00:00.000Z");
  });

  it("returns null for garbage input", () => {
    expect(icsDateToIso("not-a-date")).toBeNull();
  });
});

describe("owlCentralAdapter", () => {
  it("fetches and maps ICS events into DiscoveredItems, capped by maxItems", async () => {
    const fakeFetch = (async () =>
      new Response(SAMPLE_ICS, { status: 200 })) as unknown as typeof fetch;

    const items = await owlCentralAdapter.fetchNew({
      source: { id: "src-1", url: "https://fau.campuslabs.com/engage/calendar.ics", instagramHandle: null, metadata: {} },
      lastSuccessfulCheckAt: null,
      maxItems: 1,
      fetchImpl: fakeFetch,
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.externalId).toBe("owlcentral-evt-88213");
    expect(items[0]!.rawText).toContain("Sunset Yoga on the Green");
  });

  it("throws a descriptive error when the source has no URL", async () => {
    await expect(
      owlCentralAdapter.fetchNew({
        source: { id: "src-2", url: null, instagramHandle: null, metadata: {} },
        lastSuccessfulCheckAt: null,
      }),
    ).rejects.toThrow(/no URL configured/);
  });
});
