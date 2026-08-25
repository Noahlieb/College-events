import {
  parseEventDate,
  scoreEvent,
  type AdapterType,
  type EventCategory,
  type EventStatus,
} from "@college-events/core";

export const FAU_TZ = "America/New_York";

export const FAU_SCHOOL = {
  name: "Florida Atlantic University",
  shortName: "FAU",
  primaryDomain: "fau.edu",
  city: "Boca Raton",
  state: "FL",
  latitude: 26.3683,
  longitude: -80.1289,
  timezone: FAU_TZ,
  active: true,
  branding: {
    primaryColor: "#B31F2B", // FAU-inspired red, intentionally not the official Pantone
    secondaryColor: "#0A2A55", // deep blue
    accentColor: "#FFFFFF",
    backgroundColor: "#0B0B0F", // near-black for gradient overlays
    fontFamily: "Anton, Helvetica, Arial, sans-serif",
  },
  defaultRadiusMiles: 50,
  // Two lanes, strictly separated by event category — see
  // core/logic/lanes.ts. The former midweek_activities slot was removed
  // deliberately: it drew from the same pool as the other two and was the
  // main way an event ended up in a post that didn't match its category.
  weeklySchedule: [
    { postType: "monday_campus", dayOfWeek: 1, label: "This Week at FAU", hour: 9, minute: 0 },
    { postType: "thursday_nightlife", dayOfWeek: 4, label: "Weekend Guide", hour: 15, minute: 0 },
  ],
  instagramAccount: "@faucampusscene",
} as const;

export interface SeedSource {
  key: string; // local key used to wire up raw_content below
  name: string;
  sourceType:
    | "instagram"
    | "owl_central"
    | "university_calendar"
    | "athletics"
    | "eventbrite"
    | "venue_website"
    | "ticketing_website"
    | "rss"
    | "ical"
    | "generic_webpage"
    | "manual_submission"
    | "other_api";
  /** How we talk to the platform. Reusable across universities — the
   * school-specific parts live in `config`. */
  adapterType: AdapterType;
  category: "campus" | "nearby" | "instagram_watchlist";
  url?: string;
  /** Crawl entry point when it differs from the public URL (API root, feed). */
  discoveryUrl?: string;
  instagramHandle?: string;
  /** Adapter-specific settings; see each adapter for its shape. */
  config?: Record<string, unknown>;
  /** Single legacy number that used to mean trust, queue order and scoring
   * weight all at once. Still the default for all three below. */
  priority: number;
  /** Whose facts win a merge. Defaults to `priority`. */
  trustScore?: number;
  /** Crawl queue ordering. Defaults to `priority`. */
  crawlPriority?: number;
  /** Scoring nudge for events from this source. Defaults to 0. */
  relevanceBias?: number;
  scrapeFrequencyMinutes?: number;
  /** Defaults to true. Instagram sources are seeded inactive since they need a live
   * PhantomBuster agent to actually produce content — see README's PhantomBuster
   * section. Everything driving the default demo/test data is a real pollable
   * adapter (ical/rss/generic_webpage) instead. */
  active?: boolean;
  /** Pins every event from this source to one category, overriding per-event
   * AI/keyword classification. For a single-purpose source (a nightlife-only
   * listing site) this is both more accurate than classifying each caption
   * and what guarantees its events can only reach one posting lane.
   * Stored as `sources.metadata.forceCategory`. */
  forceCategory?: EventCategory;
}

/**
 * Six real, currently-live sources, each backing at least one real event
 * below — every row in this file traces back to a user-supplied CSV of
 * genuine FAU/Fort Lauderdale-area events (fau_combined_events.csv),
 * cross-referenced by the event's own Link column: Owl Central for
 * campus events, fausports.com for every athletics fixture (home and
 * away), and each nightlife venue's own site otherwise.
 */
// FAU's live event data comes from exactly three sources, each fed by a
// scraper the user built and runs on their own machine via daily cron —
// everything else below is seeded inactive: kept for reference/rollback
// (a one-click re-enable on the Sources page) rather than deleted outright.
export const FAU_SOURCES: SeedSource[] = [
  // The 3 active sources — do not flip these to active:false.
  { key: "fau_athletics", name: "FAU Athletics (fausports.com)", sourceType: "athletics", adapterType: "sidearm", category: "campus", url: "https://fausports.com", priority: 9, scrapeFrequencyMinutes: 240 },
  // Owl Central is FAU's CampusLabs/Anthology Engage install. It is crawled
  // directly by the reusable `campuslabs` adapter — the host is the only
  // school-specific fact, which is why the same adapter serves UCF's Knight
  // Connect or any other Engage campus with a different `config.host`.
  //
  // This replaced `scrape_owlcentral.py → CSV → import-csv`. That route
  // worked, but it made automated ingestion depend on a Python cron running
  // somewhere, and pushed every field through a lossy flat-text round trip.
  { key: "owl_central_csv", name: "Owl Central", sourceType: "university_calendar", adapterType: "campuslabs", category: "campus", url: "https://fau.campuslabs.com/engage/events", priority: 8, scrapeFrequencyMinutes: 240,
    config: { host: "fau.campuslabs.com", lookaheadDays: 45, pageSize: 100 } },
  // Nightlife listings. Crawled from configured event URLs when posh.vip
  // serves them; when it answers with an anti-bot challenge the source goes
  // DEGRADED and other nearby sources cover the same events. We do not try
  // to defeat the challenge.
  { key: "posh_vip", name: "Posh.vip Nightlife", sourceType: "ticketing_website", adapterType: "posh", category: "nearby", url: "https://posh.vip/explore", priority: 6, scrapeFrequencyMinutes: 1440, forceCategory: "nightlife",
    config: { eventUrls: [] as string[] } },

  // Inactive — superseded by the 3 sources above, kept for reference/rollback.
  // Retained as the documented fallback path (structured API → RSS → iCal →
  // page extraction). The live source above will use this feed if the API
  // stops answering; kept as its own row so it can also be enabled alone.
  { key: "owl_central", name: "Owl Central (iCal feed)", sourceType: "ical", adapterType: "ical", category: "campus", url: "https://fau.campuslabs.com/engage/events.ics", priority: 7, scrapeFrequencyMinutes: 360, active: false },
  { key: "culture_room", name: "Culture Room", sourceType: "venue_website", adapterType: "generic_web", category: "nearby", url: "https://www.cultureroom.net/", priority: 6, scrapeFrequencyMinutes: 720, active: false },
  { key: "wharf_ftl", name: "The Wharf Fort Lauderdale", sourceType: "venue_website", adapterType: "generic_web", category: "nearby", url: "https://wharfftl.com/events/", priority: 5, scrapeFrequencyMinutes: 720, active: false },
  { key: "revolution_live", name: "Revolution Live", sourceType: "venue_website", adapterType: "generic_web", category: "nearby", url: "https://www.jointherevolution.net/concerts/", priority: 5, scrapeFrequencyMinutes: 720, active: false },
  { key: "visit_lauderdale", name: "Visit Lauderdale — Nightlife Guide", sourceType: "generic_webpage", adapterType: "generic_web", category: "nearby", url: "https://www.visitlauderdale.com/nightlife/", priority: 4, scrapeFrequencyMinutes: 720, active: false },
  { key: "fau_sg_ig", name: "@fau_sg (Student Government)", sourceType: "instagram", adapterType: "external_social", category: "instagram_watchlist", instagramHandle: "fau_sg", priority: 6, scrapeFrequencyMinutes: 180, active: false },
  { key: "fau_union_ig", name: "@fauunion (Student Union)", sourceType: "instagram", adapterType: "external_social", category: "instagram_watchlist", instagramHandle: "fauunion", priority: 6, scrapeFrequencyMinutes: 180, active: false },
  { key: "sofla_nightlife_ig", name: "@sofla.nightlife (promoter)", sourceType: "instagram", adapterType: "external_social", category: "instagram_watchlist", instagramHandle: "sofla.nightlife", priority: 4, scrapeFrequencyMinutes: 360, active: false },
  // Utility source manual entries attach to — treated as authoritative since a human verified the details.
  // What hand-entered events and admin CSV uploads attach to. CSV is no
  // longer an automated integration path — it is an operator tool — so this
  // is the source those rows land on.
  { key: "manual_entry", name: "Manual Entry (VA / Team Submissions)", sourceType: "manual_submission", adapterType: "manual", category: "campus", priority: 8, scrapeFrequencyMinutes: 0, active: false },
];

function dt(date: string, startTime: string, endTime?: string) {
  return parseEventDate({ date, startTime, endTime: endTime ?? null, timezone: FAU_TZ });
}

export interface SeedEvent {
  key: string;
  sourceKeys: string[]; // one or more sources this event is corroborated by
  /** Real direct link to this specific event (the CSV's own Link column) —
   * used as the event's sourceUrl instead of a placeholder. */
  link: string;
  name: string;
  description: string;
  date: string;
  startTime: string;
  endTime?: string;
  conflictingStartTime?: string; // when present, second sourceKey reports this instead
  venue: string;
  address?: string;
  city: string;
  latitude: number;
  longitude: number;
  price: string | null;
  ageRequirement?: string | null;
  category: EventCategory;
  organization: string;
  sourceImage: string | null;
  isCampusAffiliated: boolean;
  isRecurring?: boolean;
  statusOverride?: EventStatus;
  flags?: string[];
}

/**
 * 27 of the 30 events from the user-supplied CSV, seeded as already-
 * discovered/processed (the other 3 are below in FAU_PENDING_RAW_CONTENT,
 * so the AI extraction demo step still has real work to do). Every date,
 * time, venue, organization, and image URL is taken directly from the
 * CSV — nothing invented. `sourceImage` points at each event's real
 * image URL (official Owl Central event graphics via campuslabs.com,
 * official team logos via fausports.com's sidearmdev CDN, or the
 * placehold.co placeholder graphic the CSV itself supplied for a few
 * concert listings) — this sandbox still can't fetch any of them (see
 * README's network section), but wherever this runs with real internet
 * access, these will resolve and render for real.
 *
 * This CSV pull happens to be single-source per event, all-upcoming,
 * and — because scoring is distance-based — the two away games
 * (Tallahassee, Macon) naturally score low on their own without any
 * flag, so it doesn't manufacture the multi-source/conflict/expired/
 * low-relevance/no-image scenarios spec §37 asks a seed fixture to
 * cover. Those are unit-tested directly and thoroughly at the logic
 * level instead (see packages/core/src/logic/{verification,dedup,
 * scoring,dates}.test.ts and packages/render's no-image fallback test) —
 * see data.test.ts for what this file's own tests now assert.
 */
export const FAU_EVENTS: SeedEvent[] = [
  {
    key: "soar_fair",
    sourceKeys: ["owl_central"],
    link: "https://fau.campuslabs.com/engage/event/12555417",
    name: "SOAR Fair",
    description: "Free food & giveaways at the John D. MacArthur Campus Library.",
    date: "2026-08-19",
    startTime: "09:00",
    endTime: "11:00",
    venue: "John D. MacArthur Campus Library",
    address: "5353 Parkside Dr, Jupiter, FL",
    city: "Jupiter",
    latitude: 26.8823,
    longitude: -80.1147,
    price: "Free",
    category: "campus",
    organization: "FAU Library",
    sourceImage: "https://se-images.campuslabs.com/clink/images/1a3a843e-4dbb-44e6-b0a4-586ae9a04c4b1cad5a9d-4ef5-4f8e-9242-9abb63cd0299.png",
    isCampusAffiliated: true,
  },
  {
    key: "womens_soccer_fsu",
    sourceKeys: ["fau_athletics"],
    link: "https://fausports.com/sports/womens-soccer/schedule",
    name: "Women's Soccer: FAU at Florida State",
    description: "Away match at Florida State.",
    date: "2026-08-20",
    startTime: "19:00",
    venue: "Tallahassee, FL",
    city: "Tallahassee",
    latitude: 30.4383,
    longitude: -84.3044,
    price: null,
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: "https://images.sidearmdev.com/crop?url=https%3A%2F%2Fdxbhsrqyrr690.cloudfront.net%2Fsidearm.nextgen.sites%2Ffausports.com%2Fimages%2Flogos%2FFlorida-State.png&width=300&height=300&type=png",
    isCampusAffiliated: true,
  },
  {
    key: "mens_soccer_mercer",
    sourceKeys: ["fau_athletics"],
    link: "https://fausports.com/sports/mens-soccer/schedule",
    name: "Men's Soccer: FAU at Mercer",
    description: "Away match at Mercer.",
    date: "2026-08-20",
    startTime: "19:00",
    venue: "Macon, GA",
    city: "Macon",
    latitude: 32.8407,
    longitude: -83.6324,
    price: null,
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: "https://images.sidearmdev.com/crop?url=https%3A%2F%2Fdxbhsrqyrr690.cloudfront.net%2Fsidearm.nextgen.sites%2Ffausports.com%2Fimages%2Flogos%2FMercer_logo.png&width=300&height=300&type=png",
    isCampusAffiliated: true,
  },
  {
    key: "volleyball_miami_exhibition",
    sourceKeys: ["fau_athletics"],
    link: "https://fausports.com/sports/womens-volleyball/schedule",
    name: "Volleyball: FAU at Miami (Exhibition)",
    description: "Exhibition match at Miami.",
    date: "2026-08-22",
    startTime: "13:00",
    venue: "Coral Gables, FL",
    city: "Coral Gables",
    latitude: 25.7215,
    longitude: -80.2684,
    price: null,
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: "https://images.sidearmdev.com/crop?url=https%3A%2F%2Fdxbhsrqyrr690.cloudfront.net%2Fsidearm.nextgen.sites%2Ffausports.com%2Fimages%2Flogos%2FMiami.png&width=300&height=300&type=png",
    isCampusAffiliated: true,
  },
  {
    key: "welcome_library_first_day",
    sourceKeys: ["owl_central"],
    link: "https://fau.campuslabs.com/engage/event/12559777",
    name: "Welcome to YOUR Library #FirstDay",
    description: "Giveaways & photo booth at S.E. Wimberly Library.",
    date: "2026-08-24",
    startTime: "11:00",
    endTime: "13:00",
    venue: "S.E. Wimberly Library",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3719,
    longitude: -80.1027,
    price: "Free",
    category: "campus",
    organization: "FAU Library",
    sourceImage: "https://se-images.campuslabs.com/clink/images/586cf9bc-56d5-46ae-a6c9-c57b7500882aeba8929b-9777-47ad-9eb9-6ba94716b509.png",
    isCampusAffiliated: true,
  },
  {
    key: "honors_welcome_ceremony",
    sourceKeys: ["owl_central"],
    link: "https://fau.campuslabs.com/engage/event/12476975",
    name: "University Honors Students Welcome Ceremony",
    description: "Meet honors faculty on the Boca Raton campus.",
    date: "2026-08-24",
    startTime: "16:00",
    endTime: "17:00",
    venue: "Boca Raton Campus",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3707,
    longitude: -80.1013,
    price: "Free",
    category: "academic",
    organization: "University Scholars Club",
    sourceImage: "https://se-images.campuslabs.com/clink/images/a62f2d71-2108-4d27-a7dc-9f99b36bffff45cd8511-e184-4484-b226-a939ab86ffef.png",
    isCampusAffiliated: true,
  },
  {
    key: "hoots_birthday_party",
    sourceKeys: ["owl_central"],
    link: "https://fau.campuslabs.com/engage/event/12429262",
    name: "Hoot's Birthday Party – Red & Blue Week",
    description: "DJ, cake, free food at Live Oak Pavilion, Student Union.",
    date: "2026-08-25",
    startTime: "17:00",
    endTime: "19:00",
    venue: "Live Oak Pavilion, Student Union",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3707,
    longitude: -80.1013,
    price: "Free",
    category: "party",
    organization: "Student Union Productions",
    sourceImage: "https://se-images.campuslabs.com/clink/images/7ed961b7-1548-4b65-b9ab-9b3d6e3022aeb4d95dea-9dcd-4bbd-b88d-ef80b9e5718b.png",
    isCampusAffiliated: true,
  },
  {
    key: "first_gen_welcome_reception",
    sourceKeys: ["owl_central"],
    link: "https://fau.campuslabs.com/engage/event/12546824",
    name: "First-Generation Welcome Reception",
    description: "Free food & swag at the Grand Palm, Student Union.",
    date: "2026-08-25",
    startTime: "17:00",
    endTime: "19:00",
    venue: "Grand Palm, Student Union",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3707,
    longitude: -80.1013,
    price: "Free",
    category: "community",
    organization: "Office of First-Gen Student Success",
    sourceImage: "https://se-images.campuslabs.com/clink/images/41a3afc5-3a9d-4f91-bf20-6d2b5e3c966f39162f23-491b-42ff-91a7-5ca353cea7f1.png",
    isCampusAffiliated: true,
  },
  {
    key: "naacp_general_body",
    sourceKeys: ["owl_central"],
    link: "https://fau.campuslabs.com/engage/event/12537211",
    name: "NAACP General Body Meeting",
    description: "Mix & mingle, refreshments at FAU Student Union.",
    date: "2026-08-26",
    startTime: "16:00",
    endTime: "20:00",
    venue: "FAU Student Union",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3707,
    longitude: -80.1013,
    price: "Free",
    category: "student_org",
    organization: "NAACP at FAU",
    sourceImage: "https://se-images.campuslabs.com/clink/images/743cb231-39b8-4d25-a4cb-7705c9f3ce8af9138851-ebab-42ef-9558-1e71196c15ee.png",
    isCampusAffiliated: true,
  },
  {
    key: "womens_soccer_howard",
    sourceKeys: ["fau_athletics"],
    link: "https://fausports.com/sports/womens-soccer/schedule",
    name: "Women's Soccer: FAU vs Howard",
    description: "Home match at FAU Soccer Stadium.",
    date: "2026-08-27",
    startTime: "17:00",
    venue: "FAU Soccer Stadium",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3702,
    longitude: -80.1007,
    price: "Free with Owl Card",
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: "https://images.sidearmdev.com/crop?url=https%3A%2F%2Fdxbhsrqyrr690.cloudfront.net%2Fsidearm.nextgen.sites%2Ffausports.com%2Fimages%2Flogos%2FHoward.png&width=300&height=300&type=png",
    isCampusAffiliated: true,
  },
  {
    key: "mens_soccer_north_florida",
    sourceKeys: ["fau_athletics"],
    link: "https://fausports.com/sports/mens-soccer/schedule",
    name: "Men's Soccer: FAU vs North Florida",
    description: "Home match at FAU Soccer Stadium.",
    date: "2026-08-27",
    startTime: "19:30",
    venue: "FAU Soccer Stadium",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3702,
    longitude: -80.1007,
    price: "Free with Owl Card",
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: "https://images.sidearmdev.com/crop?url=https%3A%2F%2Fdxbhsrqyrr690.cloudfront.net%2Fsidearm.nextgen.sites%2Ffausports.com%2Fimages%2Flogos%2FUNF_Primary-White%20%281%29%20%281%29.png&width=300&height=300&type=png",
    isCampusAffiliated: true,
  },
  {
    key: "night_owls_meet_greet",
    sourceKeys: ["owl_central"],
    link: "https://fau.campuslabs.com/engage/event/12523550",
    name: "Night Owls Meet and Greet",
    description: "Free snacks at The Burrow (Jupiter campus).",
    date: "2026-08-28",
    startTime: "17:00",
    endTime: "19:00",
    venue: "The Burrow",
    address: "5353 Parkside Dr, Jupiter, FL",
    city: "Jupiter",
    latitude: 26.8823,
    longitude: -80.1147,
    price: "Free",
    category: "student_org",
    organization: "Jupiter Night Owls",
    sourceImage: "https://se-images.campuslabs.com/clink/images/0b13949b-dfd9-4c51-a167-7cad082055e7c2d90288-59de-4d06-9bf4-85601edc8e94.png",
    isCampusAffiliated: true,
  },
  {
    key: "sparrow_rooftop_dj_night",
    sourceKeys: ["visit_lauderdale"],
    link: "https://www.visitlauderdale.com/nightlife/",
    name: "Rooftop DJ Night",
    description: "Recurring Thursday–Saturday rooftop DJ night. 21+.",
    date: "2026-08-28",
    startTime: "22:00",
    venue: "Sparrow at The Dalmar",
    address: "Flagler Village, Fort Lauderdale, FL",
    city: "Fort Lauderdale",
    latitude: 26.1264,
    longitude: -80.1442,
    price: null,
    ageRequirement: "21+",
    category: "nightlife",
    organization: "Sparrow at The Dalmar",
    sourceImage: "https://placehold.co/600x400/6d28d9/ffffff?text=Sparrow%2BRooftop",
    isCampusAffiliated: false,
    isRecurring: true,
  },
  {
    key: "volleyball_merrimack",
    sourceKeys: ["fau_athletics"],
    link: "https://fausports.com/sports/womens-volleyball/schedule",
    name: "Volleyball: FAU vs Merrimack (FAU Invitational)",
    description: "Home match at Baldwin Arena.",
    date: "2026-08-28",
    startTime: "10:00",
    venue: "Baldwin Arena",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3733,
    longitude: -80.1027,
    price: "Free",
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: "https://images.sidearmdev.com/crop?url=https%3A%2F%2Fdxbhsrqyrr690.cloudfront.net%2Fsidearm.nextgen.sites%2Ffausports.com%2Fimages%2Flogos%2FMerrimack.png&width=300&height=300&type=png",
    isCampusAffiliated: true,
  },
  {
    key: "volleyball_stetson",
    sourceKeys: ["fau_athletics"],
    link: "https://fausports.com/sports/womens-volleyball/schedule",
    name: "Volleyball: FAU vs Stetson (FAU Invitational)",
    description: "Home match at Baldwin Arena.",
    date: "2026-08-28",
    startTime: "19:00",
    venue: "Baldwin Arena",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3733,
    longitude: -80.1027,
    price: "Free",
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: "https://images.sidearmdev.com/crop?url=https%3A%2F%2Fdxbhsrqyrr690.cloudfront.net%2Fsidearm.nextgen.sites%2Ffausports.com%2Fimages%2Flogos%2Fstetson_200x200.png&width=300&height=300&type=png",
    isCampusAffiliated: true,
  },
  {
    key: "volleyball_fiu",
    sourceKeys: ["fau_athletics"],
    link: "https://fausports.com/sports/womens-volleyball/schedule",
    name: "Volleyball: FAU vs FIU (FAU Invitational)",
    description: "Home match at Baldwin Arena.",
    date: "2026-08-29",
    startTime: "14:00",
    venue: "Baldwin Arena",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3733,
    longitude: -80.1027,
    price: "Free",
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: "https://images.sidearmdev.com/crop?url=https%3A%2F%2Fdxbhsrqyrr690.cloudfront.net%2Fsidearm.nextgen.sites%2Ffausports.com%2Fimages%2Flogos%2FFIU-Logo%20Updated.png&width=300&height=300&type=png",
    isCampusAffiliated: true,
  },
  {
    key: "sundays_on_the_river",
    sourceKeys: ["wharf_ftl"],
    link: "https://wharfftl.com/events/",
    name: "Sundays on the River",
    description: "Recurring weekly live music at Riverwalk.",
    date: "2026-08-30",
    startTime: "14:00",
    venue: "The Wharf Fort Lauderdale",
    address: "Riverwalk, Fort Lauderdale, FL",
    city: "Fort Lauderdale",
    latitude: 26.1195,
    longitude: -80.1418,
    price: null,
    category: "nightlife",
    organization: "The Wharf Fort Lauderdale",
    sourceImage: "https://placehold.co/600x400/6d28d9/ffffff?text=Sundays%2Bon%2Bthe%2BRiver",
    isCampusAffiliated: false,
    isRecurring: true,
  },
  {
    key: "mens_soccer_nc_state",
    sourceKeys: ["fau_athletics"],
    link: "https://fausports.com/sports/mens-soccer/schedule",
    name: "Men's Soccer: FAU vs No. 2 NC State",
    description: "Home match at FAU Soccer Stadium.",
    date: "2026-08-30",
    startTime: "19:00",
    venue: "FAU Soccer Stadium",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3702,
    longitude: -80.1007,
    price: "Free with Owl Card",
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: "https://images.sidearmdev.com/crop?url=https%3A%2F%2Fdxbhsrqyrr690.cloudfront.net%2Fsidearm.nextgen.sites%2Ffausports.com%2Fimages%2Flogos%2FWolfHeadLogo.png&width=300&height=300&type=png",
    isCampusAffiliated: true,
  },
  {
    key: "meet_soa_orgs",
    sourceKeys: ["owl_central"],
    link: "https://fau.campuslabs.com/engage/event/12465427",
    name: "Meet the SOA Student Organizations",
    description: "Org mixer, free food on the Boca Raton campus.",
    date: "2026-08-31",
    startTime: "17:00",
    endTime: "20:00",
    venue: "Boca Raton Campus",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3707,
    longitude: -80.1013,
    price: "Free",
    category: "student_org",
    organization: "Beta Alpha Psi",
    sourceImage: "https://se-images.campuslabs.com/clink/images/1e4bbf95-7ec0-4f0f-9f5d-1cbb153feba69f26fa97-9106-43a2-acba-db6a50eca899.png",
    isCampusAffiliated: true,
  },
  {
    key: "noche_de_juegos",
    sourceKeys: ["owl_central"],
    link: "https://fau.campuslabs.com/engage/event/12511040",
    name: "Noche de Juegos",
    description: "Games & laughter at FAU Boca Raton.",
    date: "2026-09-01",
    startTime: "17:00",
    endTime: "19:00",
    venue: "FAU Boca Raton",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3707,
    longitude: -80.1013,
    price: "Free",
    category: "community",
    organization: "Latino Hispanic Association",
    sourceImage: "https://se-images.campuslabs.com/clink/images/517fbe80-7757-42ac-8d00-2b7bb627c9ca657a67eb-5963-4224-b84c-f2b280e15617.png",
    isCampusAffiliated: true,
  },
  {
    key: "martini_thursdays",
    sourceKeys: ["wharf_ftl"],
    link: "https://wharfftl.com/events/",
    name: "2-for-1 Martini Thursdays",
    description: "Recurring weekly. 21+.",
    date: "2026-09-03",
    startTime: "18:00",
    venue: "The Wharf Fort Lauderdale",
    address: "Riverwalk, Fort Lauderdale, FL",
    city: "Fort Lauderdale",
    latitude: 26.1195,
    longitude: -80.1418,
    price: null,
    ageRequirement: "21+",
    category: "nightlife",
    organization: "The Wharf Fort Lauderdale",
    sourceImage: "https://placehold.co/600x400/6d28d9/ffffff?text=Martini%2BThursdays",
    isCampusAffiliated: false,
    isRecurring: true,
  },
  {
    key: "elbo_room_live_music",
    sourceKeys: ["visit_lauderdale"],
    link: "https://www.visitlauderdale.com/nightlife/",
    name: "Live Music on the Beach",
    description: "Recurring, barefoot bar on Fort Lauderdale Beach.",
    date: "2026-09-04",
    startTime: "20:00",
    venue: "Elbo Room",
    address: "Fort Lauderdale Beach, FL",
    city: "Fort Lauderdale",
    latitude: 26.1224,
    longitude: -80.1057,
    price: null,
    category: "nightlife",
    organization: "Elbo Room",
    sourceImage: "https://placehold.co/600x400/6d28d9/ffffff?text=Elbo%2BRoom%2BLive",
    isCampusAffiliated: false,
    isRecurring: true,
  },
  {
    key: "citizen_halcyon_blues",
    sourceKeys: ["revolution_live"],
    link: "https://www.jointherevolution.net/concerts/",
    name: "Citizen: Halcyon Blues",
    description: "Concert, all ages, at Revolution Live.",
    date: "2026-09-05",
    startTime: "18:00",
    venue: "Revolution Live",
    address: "100 SW 3rd Ave, Fort Lauderdale, FL",
    city: "Fort Lauderdale",
    latitude: 26.1201,
    longitude: -80.1434,
    price: null,
    category: "concert",
    organization: "Revolution Live",
    sourceImage: "https://placehold.co/600x400/6d28d9/ffffff?text=Citizen",
    isCampusAffiliated: false,
  },
  {
    key: "nicko_mcbrain_titanium_tart",
    sourceKeys: ["culture_room"],
    link: "https://www.cultureroom.net/",
    name: "Nicko McBrain's Titanium Tart (Iron Maiden)",
    description: "Concert at Culture Room.",
    date: "2026-09-05",
    startTime: "19:30",
    venue: "Culture Room",
    address: "3045 N Federal Hwy, Fort Lauderdale, FL",
    city: "Fort Lauderdale",
    latitude: 26.1636,
    longitude: -80.1256,
    price: null,
    category: "concert",
    organization: "Culture Room",
    sourceImage: "https://placehold.co/600x400/6d28d9/ffffff?text=Nicko%2BMcBrain",
    isCampusAffiliated: false,
  },
  {
    key: "anthony_green",
    sourceKeys: ["culture_room"],
    link: "https://www.cultureroom.net/",
    name: "Anthony Green – This Tour Won't Save You",
    description: "Concert at Culture Room.",
    date: "2026-08-19",
    startTime: "19:00",
    venue: "Culture Room",
    address: "3045 N Federal Hwy, Fort Lauderdale, FL",
    city: "Fort Lauderdale",
    latitude: 26.1636,
    longitude: -80.1256,
    price: null,
    category: "concert",
    organization: "Culture Room",
    sourceImage: "https://placehold.co/600x400/6d28d9/ffffff?text=Anthony%2BGreen",
    isCampusAffiliated: false,
  },
  {
    key: "thirsty_thursdays",
    sourceKeys: ["visit_lauderdale"],
    link: "https://www.visitlauderdale.com/nightlife/",
    name: "Thirsty Thursdays (21+)",
    description: "Recurring weekly at Tin Roof Fort Lauderdale.",
    date: "2026-08-27",
    startTime: "21:00",
    venue: "Tin Roof Fort Lauderdale",
    address: "Fort Lauderdale, FL",
    city: "Fort Lauderdale",
    latitude: 26.1195,
    longitude: -80.1441,
    price: null,
    ageRequirement: "21+",
    category: "nightlife",
    organization: "Tin Roof Fort Lauderdale",
    sourceImage: "https://placehold.co/600x400/6d28d9/ffffff?text=Thirsty%2BThursdays",
    isCampusAffiliated: false,
    isRecurring: true,
  },
  {
    key: "jutes_culture_room",
    sourceKeys: ["culture_room"],
    link: "https://www.cultureroom.net/",
    name: "Jutes",
    description: "Concert at Culture Room.",
    date: "2026-09-17",
    startTime: "19:30",
    venue: "Culture Room",
    address: "3045 N Federal Hwy, Fort Lauderdale, FL",
    city: "Fort Lauderdale",
    latitude: 26.1636,
    longitude: -80.1256,
    price: null,
    category: "concert",
    organization: "Culture Room",
    sourceImage: "https://placehold.co/600x400/6d28d9/ffffff?text=Jutes",
    isCampusAffiliated: false,
  },
];

/** Raw, unprocessed discoveries seeded as `pending` so the AI pipeline
 * (apps/worker `process` command) has real work to do on a fresh demo
 * run — the remaining 3 real events from the CSV, written in the
 * informal style real scraped text actually has, but every fact (date,
 * time, venue, organization) is identical to the source CSV row. */
export interface SeedRawContent {
  key: string;
  sourceKey: string;
  externalId: string;
  sourceUrl: string;
  rawText: string;
  mediaUrl: string | null;
  publishedAt: string; // ISO
}

export const FAU_PENDING_RAW_CONTENT: SeedRawContent[] = [
  {
    key: "pending_mens_soccer_ucf",
    sourceKey: "fau_athletics",
    externalId: "fausports-mens-soccer-ucf-2026-08-23",
    sourceUrl: "https://fausports.com/sports/mens-soccer/schedule",
    rawText: "Men's Soccer vs UCF — Sunday 8/23, 6pm at FAU Soccer Stadium. Home opener.",
    mediaUrl: "https://images.sidearmdev.com/crop?url=https%3A%2F%2Fdxbhsrqyrr690.cloudfront.net%2Fsidearm.nextgen.sites%2Ffausports.com%2Fimages%2Flogos%2FUCF.png&width=300&height=300&type=png",
    publishedAt: "2026-08-14T14:00:00.000Z",
  },
  {
    key: "pending_doughnuts_dean",
    sourceKey: "owl_central",
    externalId: "owlcentral-doughnuts-with-dean-2026-08-27",
    sourceUrl: "https://fau.campuslabs.com/engage/event/12559878",
    rawText: "Doughnuts with the Dean — free food and coffee, Thurs 8/27 11am-12pm at Wimberly Library Lobby.",
    mediaUrl: "https://se-images.campuslabs.com/clink/images/2fba2c94-510a-4d1d-be70-2c4b22845270933af0d1-801b-4a70-b8ef-895cb22e8a92.png",
    publishedAt: "2026-08-13T16:00:00.000Z",
  },
  {
    key: "pending_buckcherry",
    sourceKey: "culture_room",
    externalId: "cultureroom-buckcherry-2026-08-22",
    sourceUrl: "https://www.cultureroom.net/",
    rawText: "Buckcherry w/ Black Stone Cherry — concert at Culture Room, Sat 8/22 7:30pm, 3045 N Federal Hwy, Fort Lauderdale.",
    mediaUrl: "https://placehold.co/600x400/6d28d9/ffffff?text=Buckcherry",
    publishedAt: "2026-08-12T18:00:00.000Z",
  },
];

export { dt };
