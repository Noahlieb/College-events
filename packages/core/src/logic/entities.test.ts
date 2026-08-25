import { describe, expect, it } from "vitest";
import { domainOf, matchEntity, normalizeEntityName, type EntityCandidate } from "./entities.js";

const venue = (id: string, name: string, extra: Partial<EntityCandidate> = {}): EntityCandidate => ({
  id,
  entityType: "venue",
  name,
  ...extra,
});

describe("normalizeEntityName", () => {
  it("collapses the ways one venue gets written", () => {
    expect(normalizeEntityName("The Wharf FTL")).toBe(normalizeEntityName("Wharf Fort Lauderdale"));
  });

  it("ignores punctuation, case and corporate suffixes", () => {
    expect(normalizeEntityName("Revolution Live, LLC")).toBe(normalizeEntityName("revolution live"));
  });

  it("keeps a name that is entirely noise words rather than emptying it", () => {
    // "The Venue" is a real place; an empty key would collapse it into
    // every other all-noise name in the city.
    expect(normalizeEntityName("The Venue")).not.toBe("");
    expect(normalizeEntityName("The Venue")).not.toBe(normalizeEntityName("The Club"));
  });

  it("does not merge two genuinely different venues", () => {
    expect(normalizeEntityName("Culture Room")).not.toBe(normalizeEntityName("Revolution Live"));
  });
});

describe("domainOf", () => {
  it("strips www so one site is one domain", () => {
    expect(domainOf("https://www.cultureroom.net/events")).toBe("cultureroom.net");
  });
  it("returns null for junk", () => {
    expect(domainOf("not a url")).toBeNull();
    expect(domainOf(null)).toBeNull();
  });
});

describe("matchEntity", () => {
  const existing = [
    venue("v1", "The Wharf Fort Lauderdale", { website: "https://wharfftl.com" }),
    venue("v2", "Culture Room", { website: "https://www.cultureroom.net" }),
    venue("v3", "Revolution Live", { instagramHandle: "revolutionlive" }),
  ];

  it("treats a shared website domain as proof, whatever the name says", () => {
    const match = matchEntity(
      { entityType: "venue", name: "Wharf FTL Events", website: "https://www.wharfftl.com/calendar" },
      existing,
    );
    expect(match?.entity.id).toBe("v1");
    expect(match?.reason).toMatch(/domain/);
  });

  it("treats a shared instagram handle as proof", () => {
    const match = matchEntity(
      { entityType: "venue", name: "Rev Live", instagramHandle: "@RevolutionLive" },
      existing,
    );
    expect(match?.entity.id).toBe("v3");
  });

  it("matches on normalized name when there is no shared channel", () => {
    const match = matchEntity({ entityType: "venue", name: "the culture room" }, existing);
    expect(match?.entity.id).toBe("v2");
  });

  it("refuses to merge venues that merely rhyme", () => {
    // An over-merge attaches one venue's flyers to another's events, which
    // is far worse than leaving two rows unlinked.
    const match = matchEntity({ entityType: "venue", name: "Revolution Bar" }, existing);
    expect(match).toBeNull();
  });

  it("never matches across entity types", () => {
    // A student org called "Culture Room" is not the nightclub.
    const match = matchEntity({ entityType: "organization", name: "Culture Room" }, existing);
    expect(match).toBeNull();
  });

  it("returns null when there is nothing to match against", () => {
    expect(matchEntity({ entityType: "venue", name: "Anything" }, [])).toBeNull();
  });

  it("is symmetric about which name was seen first", () => {
    const a = matchEntity({ entityType: "venue", name: "The Wharf FTL" }, [venue("x", "Wharf Fort Lauderdale")]);
    const b = matchEntity({ entityType: "venue", name: "Wharf Fort Lauderdale" }, [venue("x", "The Wharf FTL")]);
    expect(Boolean(a)).toBe(Boolean(b));
  });
});
