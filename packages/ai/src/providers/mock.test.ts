import { describe, expect, it } from "vitest";
import { MockAIProvider } from "./mock.js";
import { ExtractedEventSchema } from "../schemas.js";

const provider = new MockAIProvider();
const schoolContext = { name: "Florida Atlantic University", shortName: "FAU", city: "Boca Raton", state: "FL", timezone: "America/New_York" };

describe("MockAIProvider.analyzeEvent", () => {
  it("extracts date, time range, and price from a well-formed caption", async () => {
    const result = await provider.analyzeEvent({
      schoolContext,
      sourceName: "Owl Central",
      sourceType: "owl_central",
      sourceUrl: null,
      caption:
        "Sunset Yoga on the Green — Wednesday 8/26, 6:00-7:00pm, hosted by FAU Recreation Services. Free, mats provided while supplies last. All levels welcome.",
      publishedAt: "2026-08-14T18:30:00.000Z",
      currentDate: "2026-08-16",
    });
    expect(result.is_event).toBe(true);
    expect(result.date).toBe("2026-08-26");
    expect(result.start_time).toBe("18:00");
    expect(result.end_time).toBe("19:00");
    expect(result.price).toBe("Free");
    expect(ExtractedEventSchema.safeParse(result).success).toBe(true);
  });

  it("does not hallucinate an event from a generic caption with no date/time signal", async () => {
    const result = await provider.analyzeEvent({
      schoolContext,
      sourceName: "@sofla.nightlife",
      sourceType: "instagram",
      sourceUrl: null,
      caption: "link in bio for tickets 🔥🔥🔥 you don't want to miss this one",
      publishedAt: "2026-08-16T20:00:00.000Z",
      currentDate: "2026-08-16",
    });
    expect(result.is_event).toBe(false);
    expect(result.date).toBeNull();
    expect(result.event_name).toBeNull();
  });

  it("parses a 21+ age requirement and a 'free before' price", async () => {
    const result = await provider.analyzeEvent({
      schoolContext,
      sourceName: "Bounce Delray Beach",
      sourceType: "venue_website",
      sourceUrl: null,
      caption:
        "THROWBACK THURSDAY at Bounce Delray Beach, Sept 4th. Doors 10pm, free before 11pm, $10 after. 21+.",
      publishedAt: "2026-08-15T14:00:00.000Z",
      currentDate: "2026-08-16",
    });
    expect(result.is_event).toBe(true);
    expect(result.date).toBe("2026-09-04");
    expect(result.age_requirement).toBe("21+");
    expect(result.price?.toLowerCase()).toContain("free before");
  });
});

describe("MockAIProvider.compareDuplicates", () => {
  it("flags near-identical same-day titles as duplicates", async () => {
    const result = await provider.compareDuplicates({
      eventA: { name: "Back to School Bash", description: null, venue: "Student Union", startAt: "2026-08-24T17:00:00.000Z" },
      eventB: { name: "Back 2 School Bash!", description: null, venue: "Student Union", startAt: "2026-08-24T17:30:00.000Z" },
    });
    expect(result.is_duplicate).toBe(true);
  });

  it("does not flag unrelated events as duplicates", async () => {
    const result = await provider.compareDuplicates({
      eventA: { name: "FAU Career Fair", description: null, venue: "Arena", startAt: "2026-08-24T17:00:00.000Z" },
      eventB: { name: "Bounce Delray College Night", description: null, venue: "Bounce Delray", startAt: "2026-08-24T22:00:00.000Z" },
    });
    expect(result.is_duplicate).toBe(false);
  });
});

describe("MockAIProvider.generateCaption", () => {
  it("produces a non-empty caption referencing the school", async () => {
    const result = await provider.generateCaption({
      postType: "monday_campus",
      schoolName: schoolContext.name,
      schoolShortName: schoolContext.shortName,
      city: schoolContext.city,
      instagramHandle: "@fau.events",
      weekRangeLabel: "August 24 to 30",
      events: [{ name: "Involvement Fair", venue: "Student Union", dayLabel: "MONDAY 8/24", time: "11AM to 1PM" }],
    });
    expect(result.caption).toContain("FAU");
    expect(result.caption).toContain("Involvement Fair");
    expect(result.caption.length).toBeGreaterThan(10);
  });
});
