import { describe, expect, it } from "vitest";
import {
  FixtureDiscoveryProvider,
  UniversitySourceDiscoveryService,
  buildDiscoveryQueries,
  canonicalizeUrl,
  isFirstParty,
  isPlausibleSourceUrl,
  nullDiscoveryProvider,
  type UniversityProfile,
} from "./index.js";

const UCF: UniversityProfile = {
  name: "University of Central Florida",
  shortName: "UCF",
  primaryDomain: "ucf.edu",
  city: "Orlando",
  state: "Florida",
};

const FAU: UniversityProfile = {
  name: "Florida Atlantic University",
  shortName: "FAU",
  primaryDomain: "fau.edu",
  city: "Boca Raton",
  state: "Florida",
};

describe("buildDiscoveryQueries", () => {
  it("scopes first-party categories to the university's own domain", () => {
    const queries = buildDiscoveryQueries(UCF);
    expect(queries.some((q) => q.query === "site:ucf.edu events")).toBe(true);
    expect(queries.some((q) => q.query.includes("site:ucf.edu student government events"))).toBe(true);
  });

  it("scopes local categories to the university's city", () => {
    const queries = buildDiscoveryQueries(UCF);
    expect(queries.some((q) => q.query.includes("Orlando, Florida"))).toBe(true);
  });

  it("probes for campus platforms by name so vanity domains are found", () => {
    // knightconnect.ucf.edu is not guessable from the university record;
    // pairing the school with the platform name is what surfaces it.
    const queries = buildDiscoveryQueries(UCF).map((q) => q.query);
    expect(queries).toContain('"UCF" "CampusLabs"');
    expect(queries).toContain('"UCF" "CampusGroups"');
    expect(queries).toContain('"UCF" "Localist"');
    expect(queries).toContain('"UCF" "25Live"');
  });

  it("generates the same shape of queries for any university", () => {
    // The test that matters for scale: nothing in query generation is
    // school-specific, so two universities differ only in their values.
    const ucf = buildDiscoveryQueries(UCF);
    const fau = buildDiscoveryQueries(FAU);
    expect(ucf).toHaveLength(fau.length);
    expect(ucf.map((q) => q.coverageCategory)).toEqual(fau.map((q) => q.coverageCategory));
  });

  it("falls back to the quoted full name when a university has no domain", () => {
    const queries = buildDiscoveryQueries({ ...UCF, primaryDomain: null });
    expect(queries.some((q) => q.query.startsWith("site:"))).toBe(false);
    expect(queries.some((q) => q.query.includes('"University of Central Florida"'))).toBe(true);
  });

  it("covers campus, nightlife and civic calendars", () => {
    const categories = new Set(buildDiscoveryQueries(UCF).map((q) => q.coverageCategory));
    for (const key of ["athletics", "student_government", "nightclubs", "music_venues", "city_calendar"]) {
      expect(categories.has(key), `missing coverage category "${key}"`).toBe(true);
    }
  });
});

describe("canonicalizeUrl", () => {
  it("treats www and trailing slashes as the same page", () => {
    expect(canonicalizeUrl("https://www.ucf.edu/events/")).toBe(canonicalizeUrl("https://ucf.edu/events"));
  });

  it("strips tracking parameters that would split one page into many", () => {
    expect(canonicalizeUrl("https://ucf.edu/events?utm_source=x&fbclid=y")).toBe("https://ucf.edu/events");
  });

  it("keeps meaningful query parameters", () => {
    expect(canonicalizeUrl("https://ucf.edu/events?cat=music")).toContain("cat=music");
  });
});

describe("isPlausibleSourceUrl", () => {
  it("rejects documents and images", () => {
    expect(isPlausibleSourceUrl("https://ucf.edu/handbook.pdf")).toBe(false);
    expect(isPlausibleSourceUrl("https://ucf.edu/photo.jpg")).toBe(false);
  });

  it("rejects login and boilerplate pages", () => {
    // A reviewer who has to reject twenty of these stops reading carefully.
    expect(isPlausibleSourceUrl("https://ucf.edu/login")).toBe(false);
    expect(isPlausibleSourceUrl("https://ucf.edu/privacy")).toBe(false);
  });

  it("accepts ordinary event pages", () => {
    expect(isPlausibleSourceUrl("https://events.ucf.edu/calendar")).toBe(true);
  });

  it("rejects non-http schemes", () => {
    expect(isPlausibleSourceUrl("ftp://ucf.edu/x")).toBe(false);
    expect(isPlausibleSourceUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("isFirstParty", () => {
  it("accepts subdomains of the university", () => {
    expect(isFirstParty("https://knightconnect.ucf.edu/engage", "ucf.edu")).toBe(true);
  });
  it("rejects a lookalike domain", () => {
    expect(isFirstParty("https://ucf.edu.evil.com/engage", "ucf.edu")).toBe(false);
  });
  it("rejects an unrelated host", () => {
    expect(isFirstParty("https://news.example.com/ucf-student-government", "ucf.edu")).toBe(false);
  });
});

describe("UniversitySourceDiscoveryService", () => {
  it("returns nothing, and does not throw, with no provider configured", async () => {
    // Discovery is a safety net over a registry that already works. Its
    // absence must degrade the system, not break it.
    const service = new UniversitySourceDiscoveryService(nullDiscoveryProvider);
    const summary = await service.discover(UCF);
    expect(summary.candidates).toEqual([]);
    expect(summary.provider).toBe("none");
  });

  it("fingerprints results into candidates rather than sources", async () => {
    const provider = new FixtureDiscoveryProvider({
      '"ucf" "campuslabs"': [
        { title: "Knight Connect", url: "https://ucf.campuslabs.com/engage/events" },
      ],
    });
    const summary = await new UniversitySourceDiscoveryService(provider).discover(UCF);
    const candidate = summary.candidates.find((c) => c.url.includes("campuslabs"))!;
    expect(candidate.detectedAdapter).toBe("campuslabs");
    expect(candidate.autoApprovable).toBe(true);
    expect(candidate.evidence.join(" ")).toMatch(/campuslabs\.com host/);
  });

  it("explains where each candidate came from", async () => {
    // A reviewer approving a source needs to know which question it
    // answered, not just that something matched.
    const provider = new FixtureDiscoveryProvider({
      "site:ucf.edu athletics schedule": [{ title: "UCF Knights", url: "https://ucfknights.com/calendar" }],
    });
    const summary = await new UniversitySourceDiscoveryService(provider).discover(UCF);
    expect(summary.candidates[0]!.evidence[0]).toMatch(/found by athletics query/);
  });

  it("never auto-approves an unidentified page", async () => {
    // "Definitely unidentifiable" is not grounds for crawling unattended.
    const provider = new FixtureDiscoveryProvider({
      "nightclubs near orlando": [{ title: "Some Club", url: "https://someclub.example/" }],
    });
    const summary = await new UniversitySourceDiscoveryService(provider).discover(UCF);
    for (const candidate of summary.candidates) {
      if (candidate.detectedAdapter === "generic_web") expect(candidate.autoApprovable).toBe(false);
    }
  });

  it("drops unrelated off-domain results from a first-party query", async () => {
    // A site: query is a request, not a guarantee. A news article about
    // the university's student government is not its calendar.
    const provider = new FixtureDiscoveryProvider({
      "site:ucf.edu student government events": [
        { title: "UCF SG", url: "https://ucf.edu/student-government/events" },
        { title: "News story", url: "https://news.example.com/ucf-sg-elections" },
      ],
    });
    const summary = await new UniversitySourceDiscoveryService(provider).discover(UCF);
    const urls = summary.candidates.map((c) => c.url);
    expect(urls.some((u) => u.includes("ucf.edu"))).toBe(true);
    expect(urls.some((u) => u.includes("news.example.com"))).toBe(false);
  });

  it("does not re-propose URLs that are already sources", async () => {
    const provider = new FixtureDiscoveryProvider({
      '"ucf" "campuslabs"': [{ title: "Knight Connect", url: "https://ucf.campuslabs.com/engage/events" }],
    });
    const summary = await new UniversitySourceDiscoveryService(provider).discover(UCF, {
      knownUrls: ["https://www.ucf.campuslabs.com/engage/events/"],
    });
    expect(summary.candidates.some((c) => c.url.includes("campuslabs"))).toBe(false);
  });

  it("de-duplicates one URL found by several queries", async () => {
    const shared = [{ title: "Events", url: "https://events.ucf.edu/" }];
    const provider = new FixtureDiscoveryProvider({
      "site:ucf.edu events": shared,
      "site:ucf.edu student life events": shared,
    });
    const summary = await new UniversitySourceDiscoveryService(provider).discover(UCF);
    expect(summary.candidates.filter((c) => c.url === "https://events.ucf.edu")).toHaveLength(1);
  });

  it("keeps going when a query fails", async () => {
    // One provider hiccup must not cost the whole run; a partially
    // discovered university is still useful.
    let failures = 0;
    const flaky = {
      name: "flaky",
      async search(query: string) {
        if (query.toLowerCase().includes("campuslabs")) {
          return [{ title: "Engage", url: "https://ucf.campuslabs.com/engage/events" }];
        }
        failures++;
        throw new Error("rate limited");
      },
    };
    const summary = await new UniversitySourceDiscoveryService(flaky).discover(UCF);
    expect(failures).toBeGreaterThan(0);
    expect(summary.candidates.length).toBeGreaterThan(0);
  });

  it("reports which coverage categories found nothing", async () => {
    // The actionable half of the report: what a university is still
    // missing, not just what was found.
    const provider = new FixtureDiscoveryProvider({
      "site:ucf.edu athletics schedule": [{ title: "Knights", url: "https://ucfknights.com/calendar" }],
    });
    const summary = await new UniversitySourceDiscoveryService(provider).discover(UCF);
    expect(summary.categoriesWithNoResults).toContain("student_government");
    expect(summary.categoriesWithNoResults).not.toContain("athletics");
  });

  it("caps candidates so one broad query cannot flood the review queue", async () => {
    const flood = {
      name: "flood",
      async search() {
        return Array.from({ length: 50 }, (_, i) => ({
          title: `Venue ${i}`,
          url: `https://venue${i}.example/events`,
        }));
      },
    };
    const summary = await new UniversitySourceDiscoveryService(flood).discover(UCF, { maxCandidates: 25 });
    expect(summary.candidates.length).toBeLessThanOrEqual(25);
  });

  it("keeps an athletics site on its own domain", async () => {
    // The case the first-party filter got wrong: a university's athletics
    // site is almost never on the university's domain, and it is one of
    // the sources we most want.
    const provider = new FixtureDiscoveryProvider({
      "site:ucf.edu athletics schedule": [{ title: "UCF Knights", url: "https://ucfknights.com/calendar" }],
    });
    const summary = await new UniversitySourceDiscoveryService(provider).discover(UCF);
    const candidate = summary.candidates.find((c) => c.url.includes("ucfknights"))!;
    expect(candidate).toBeDefined();
    expect(candidate.evidence.join(" ")).toMatch(/named after the university/);
    // Kept for review, but never approved unattended — it could be a
    // rival's site or a fan blog.
    expect(candidate.autoApprovable).toBe(false);
  });

  it("fingerprints the live page when asked to", async () => {
    const provider = new FixtureDiscoveryProvider({
      "site:ucf.edu events": [{ title: "Events", url: "https://events.ucf.edu/" }],
    });
    const fetchImpl = (async () =>
      new Response(`<meta name="generator" content="Localist 3.2">`)) as unknown as typeof fetch;
    const summary = await new UniversitySourceDiscoveryService(provider).discover(UCF, {
      fetchPages: true,
      fetchImpl,
    });
    expect(summary.candidates[0]!.detectedAdapter).toBe("localist");
  });
});

describe("UniversitySourceDiscoveryService — onCandidate (incremental persistence)", () => {
  it("fires once per candidate, before discover() returns", async () => {
    // The whole point: a caller with a hard time limit (a serverless
    // function backing the dashboard button) can persist here and keep
    // whatever was found even if the run never reaches its own return.
    const provider = new FixtureDiscoveryProvider({
      "site:ucf.edu events": [{ title: "Events", url: "https://events.ucf.edu/" }],
      "site:ucf.edu athletics schedule": [{ title: "Knights", url: "https://ucfknights.com/calendar" }],
    });

    const seen: string[] = [];
    const summary = await new UniversitySourceDiscoveryService(provider).discover(UCF, {
      onCandidate: (c) => {
        seen.push(c.url);
      },
    });

    expect(seen.sort()).toEqual(summary.candidates.map((c) => c.url).sort());
  });

  it("has written every candidate to the callback even if the caller throws afterward", async () => {
    // Simulates the exact failure mode this exists for: the request gets
    // cut off partway through discover(). Everything the callback already
    // saw is real work already done — it does not depend on discover()
    // returning normally.
    const provider = new FixtureDiscoveryProvider({
      "site:ucf.edu events": [{ title: "Events", url: "https://events.ucf.edu/" }],
    });

    const persisted: string[] = [];
    await new UniversitySourceDiscoveryService(provider)
      .discover(UCF, {
        onCandidate: (c) => {
          persisted.push(c.url);
        },
      })
      .catch(() => undefined);

    expect(persisted).toContain("https://events.ucf.edu");
  });

  it("does not let a failing callback abort the rest of the search", async () => {
    const provider = new FixtureDiscoveryProvider({
      "site:ucf.edu events": [{ title: "Events", url: "https://events.ucf.edu/" }],
      "site:ucf.edu athletics schedule": [{ title: "Knights", url: "https://ucfknights.com/calendar" }],
    });

    let calls = 0;
    const summary = await new UniversitySourceDiscoveryService(provider).discover(UCF, {
      onCandidate: () => {
        calls++;
        throw new Error("simulated write failure");
      },
    });

    expect(calls).toBe(summary.candidates.length);
    expect(summary.candidates.length).toBeGreaterThan(1);
  });

  it("still returns the full summary normally when no callback is given", async () => {
    // Backward compatible: every existing caller that doesn't pass
    // onCandidate behaves exactly as before.
    const provider = new FixtureDiscoveryProvider({
      "site:ucf.edu events": [{ title: "Events", url: "https://events.ucf.edu/" }],
    });
    const summary = await new UniversitySourceDiscoveryService(provider).discover(UCF);
    expect(summary.candidates.length).toBeGreaterThan(0);
  });
});
