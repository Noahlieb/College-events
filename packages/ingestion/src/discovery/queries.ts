import type { EntityType } from "@college-events/core";

/**
 * Discovery queries, generated from a university's own record.
 *
 * Nothing here names a school. Every query is built from `name`,
 * `shortName`, `primaryDomain`, `city` and `state`, which is what makes
 * onboarding the hundredth university a data operation — the same taxonomy
 * runs against different values.
 */

export interface UniversityProfile {
  name: string;
  shortName: string;
  primaryDomain: string | null;
  city: string;
  state: string;
}

/**
 * The parts of a university's event ecosystem worth looking for. Coverage
 * is measured against this list, so it doubles as the definition of "what
 * a fully-discovered university looks like" — the denominator in the
 * coverage report, and the thing that tells an operator *what is missing*
 * rather than just that something is.
 */
export interface CoverageCategory {
  key: string;
  label: string;
  entityType: EntityType;
  /** Query fragments appended to a `site:` or quoted-name prefix. */
  terms: string[];
  /** Searched on the university's own domain rather than the open web. */
  firstParty: boolean;
  /** Categories a university is expected to have; missing ones are gaps. */
  expected: boolean;
}

export const COVERAGE_CATEGORIES: CoverageCategory[] = [
  // ── official campus ──────────────────────────────────────────────
  { key: "master_calendar", label: "University master calendar", entityType: "university", terms: ["events", "events calendar"], firstParty: true, expected: true },
  { key: "engagement_portal", label: "Student engagement portal", entityType: "university", terms: ["student organizations", "get involved", "engage"], firstParty: true, expected: true },
  { key: "student_life", label: "Student Life", entityType: "department", terms: ["student life events"], firstParty: true, expected: true },
  { key: "student_affairs", label: "Student Affairs", entityType: "department", terms: ["student affairs events"], firstParty: true, expected: false },
  { key: "student_government", label: "Student Government", entityType: "organization", terms: ["student government events"], firstParty: true, expected: true },
  { key: "programming_board", label: "Programming board", entityType: "organization", terms: ["program board events", "campus activities board"], firstParty: true, expected: true },
  { key: "student_union", label: "Student Union", entityType: "venue", terms: ["student union events"], firstParty: true, expected: true },
  { key: "campus_rec", label: "Campus Recreation", entityType: "department", terms: ["recreation events", "intramural schedule"], firstParty: true, expected: true },
  { key: "greek_life", label: "Greek Life", entityType: "organization", terms: ["fraternity sorority life events"], firstParty: true, expected: false },
  { key: "residence_life", label: "Residence Life", entityType: "department", terms: ["housing residence life events"], firstParty: true, expected: false },
  { key: "athletics", label: "Athletics", entityType: "department", terms: ["athletics schedule"], firstParty: true, expected: true },
  { key: "performing_arts", label: "Performing Arts", entityType: "venue", terms: ["performing arts events", "theatre season"], firstParty: true, expected: true },
  { key: "music", label: "Music", entityType: "department", terms: ["music department concerts"], firstParty: true, expected: false },
  { key: "museums", label: "Museums & galleries", entityType: "venue", terms: ["museum gallery exhibitions"], firstParty: true, expected: false },
  { key: "libraries", label: "Libraries", entityType: "venue", terms: ["library events"], firstParty: true, expected: false },
  { key: "career_center", label: "Career Center", entityType: "department", terms: ["career fair events"], firstParty: true, expected: true },
  { key: "entrepreneurship", label: "Entrepreneurship", entityType: "department", terms: ["entrepreneurship events"], firstParty: true, expected: false },
  { key: "orientation", label: "Orientation & traditions", entityType: "department", terms: ["orientation week of welcome", "homecoming"], firstParty: true, expected: true },
  { key: "theater", label: "Theater", entityType: "department", terms: ["theatre department productions"], firstParty: true, expected: false },
  { key: "colleges", label: "Individual colleges", entityType: "department", terms: ["college of business events", "college of engineering events"], firstParty: true, expected: false },
  { key: "departments", label: "Academic departments", entityType: "department", terms: ["department seminar series"], firstParty: true, expected: false },
  { key: "campus_venues", label: "Campus venues", entityType: "venue", terms: ["arena stadium events", "auditorium events"], firstParty: true, expected: false },
  { key: "ticket_office", label: "University ticket office", entityType: "venue", terms: ["tickets box office"], firstParty: true, expected: false },

  // ── local / nightlife ────────────────────────────────────────────
  { key: "nightclubs", label: "Nightclubs", entityType: "venue", terms: ["nightclubs"], firstParty: false, expected: true },
  { key: "college_bars", label: "College bars", entityType: "venue", terms: ["college bars near campus"], firstParty: false, expected: true },
  { key: "music_venues", label: "Music venues", entityType: "venue", terms: ["live music venues"], firstParty: false, expected: true },
  { key: "promoters", label: "Promoters & event companies", entityType: "promoter", terms: ["nightlife promoters", "event company"], firstParty: false, expected: false },
  { key: "comedy", label: "Comedy venues", entityType: "venue", terms: ["comedy club"], firstParty: false, expected: false },
  { key: "ticketed_venues", label: "Nearby ticketed venues", entityType: "venue", terms: ["amphitheater arena events"], firstParty: false, expected: false },

  // ── local public calendars ───────────────────────────────────────
  { key: "city_calendar", label: "City calendar", entityType: "organization", terms: ["city events calendar"], firstParty: false, expected: true },
  { key: "parks_rec", label: "Parks & Recreation", entityType: "organization", terms: ["parks and recreation events"], firstParty: false, expected: false },
  { key: "downtown_district", label: "Downtown district", entityType: "organization", terms: ["downtown events"], firstParty: false, expected: false },
  { key: "tourism_bureau", label: "Tourism bureau", entityType: "organization", terms: ["visitors bureau events"], firstParty: false, expected: false },
  { key: "regional_calendar", label: "Regional event calendar", entityType: "organization", terms: ["things to do this weekend"], firstParty: false, expected: false },
  { key: "entertainment_venues", label: "Entertainment venues", entityType: "venue", terms: ["entertainment venue events", "event space"], firstParty: false, expected: false },
];

/** Ticketing/nightlife platforms worth probing for a university's area. */
export const PLATFORM_PROBES = [
  "Eventbrite",
  "Posh",
  "Partiful",
  "Luma",
  "DICE",
  "Resident Advisor",
  "Tixr",
  "Ticketmaster",
  "AXS",
];

/**
 * Queries that pair the school's *abbreviation* with a local scene term.
 *
 * Students say "UCF nightlife", not "nightlife near Orlando, Florida" —
 * and the venues that court them say it too, in their page titles. These
 * surface college-facing venues that a purely geographic query buries
 * under general city nightlife.
 */
export const ABBREVIATION_SCENE_TERMS = [
  "college night",
  "student night",
  "nightlife",
  "bars near campus",
  "events this weekend",
];

/** Campus platforms worth naming explicitly — they are what an adapter reads. */
export const CAMPUS_PLATFORM_PROBES = ["CampusLabs", "CampusGroups", "Localist", "25Live", "Engage"];

export interface DiscoveryQuery {
  query: string;
  coverageCategory: string;
  entityType: EntityType;
}

/**
 * Every query to run for one university.
 *
 * First-party categories are searched with `site:` so results come from
 * the university itself; local categories are searched by city so they
 * are geographically scoped. Platform probes pair the school's name with
 * a platform name, which is how an install on a vanity domain
 * ("knightconnect.ucf.edu") gets found at all.
 */
export function buildDiscoveryQueries(university: UniversityProfile): DiscoveryQuery[] {
  const queries: DiscoveryQuery[] = [];
  const domain = university.primaryDomain;
  const place = `${university.city}, ${university.state}`;

  for (const category of COVERAGE_CATEGORIES) {
    for (const term of category.terms) {
      if (category.firstParty) {
        // Without a domain there is no way to scope to the university
        // itself, so fall back to the quoted full name.
        queries.push({
          query: domain ? `site:${domain} ${term}` : `"${university.name}" ${term}`,
          coverageCategory: category.key,
          entityType: category.entityType,
        });
      } else {
        queries.push({
          query: `${term} near ${place}`,
          coverageCategory: category.key,
          entityType: category.entityType,
        });
      }
    }
  }

  for (const platform of CAMPUS_PLATFORM_PROBES) {
    queries.push({
      query: `"${university.shortName}" "${platform}"`,
      coverageCategory: "engagement_portal",
      entityType: "university",
    });
  }

  for (const platform of PLATFORM_PROBES) {
    queries.push({
      query: `${platform} events ${place}`,
      coverageCategory: "ticketed_venues",
      entityType: "venue",
    });
    // Platform pages built for this specific student body — an Eventbrite
    // organizer running "UCF" nights is a better source than the city's
    // general Eventbrite listings.
    queries.push({
      query: `${platform} "${university.shortName}"`,
      coverageCategory: "ticketed_venues",
      entityType: "venue",
    });
  }

  for (const term of ABBREVIATION_SCENE_TERMS) {
    queries.push({
      query: `"${university.shortName}" ${term}`,
      coverageCategory: "college_bars",
      entityType: "venue",
    });
  }

  return queries;
}

/**
 * Broad "what's actually happening" queries — different in kind from
 * `buildDiscoveryQueries` above.
 *
 * The source-discovery queries look for *producers* (venues, platforms,
 * departments) so their feeds can be added to the registry. These look for
 * *events themselves*, on the open web, independent of who reported them —
 * which is what makes them useful as an outside check on the registry:
 * a producer query can only find producers we thought to search for, but
 * an event-shaped query finds whatever is actually happening regardless of
 * whether we have any idea who is behind it.
 *
 * Kept deliberately small. This runs periodically as a coverage check, not
 * on every discovery pass — a broad "what's on this weekend" search is
 * expensive to run at high frequency and cheap to run weekly.
 */
export function buildDiscoveryMissProbeQueries(university: UniversityProfile): string[] {
  const place = `${university.city}, ${university.state}`;
  return [
    `"${university.shortName}" events this week`,
    `"${university.shortName}" this weekend`,
    `things to do in ${place} this weekend`,
    `${place} events tonight`,
    `"${university.name}" party`,
    `${place} concerts this week`,
  ];
}
