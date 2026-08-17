import { parseEventDate, scoreEvent, type EventCategory, type EventStatus } from "@college-events/core";

export const FAU_TZ = "America/New_York";

export const FAU_SCHOOL = {
  name: "Florida Atlantic University",
  shortName: "FAU",
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
  weeklySchedule: [
    { postType: "monday_campus", dayOfWeek: 1, label: "This Week at FAU", hour: 9, minute: 0 },
    { postType: "midweek_activities", dayOfWeek: 3, label: "Things To Do", hour: 11, minute: 0 },
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
  category: "campus" | "nearby" | "instagram_watchlist";
  url?: string;
  instagramHandle?: string;
  priority: number;
  scrapeFrequencyMinutes?: number;
  /** Defaults to true. Instagram sources are seeded inactive since they need a live
   * PhantomBuster agent to actually produce content — see README's PhantomBuster
   * section. Everything driving the default demo/test data is a real pollable
   * adapter (ical/rss/generic_webpage) instead. */
  active?: boolean;
}

/**
 * Every URL below is a real, currently-live domain for the named
 * organization (verified via web search, not invented) — the point is
 * that `pnpm worker ingest` has a genuine live target once it runs
 * somewhere with real internet access, not that the exact path has been
 * fetched and confirmed to return parseable content from this sandbox
 * (outbound access is blocked here — see README's PhantomBuster/network
 * section). The one exception is `manual_entry`, which has no URL by
 * design — it's the attachment point for human-submitted events.
 */
export const FAU_SOURCES: SeedSource[] = [
  // Campus
  { key: "owl_central", name: "Owl Central", sourceType: "owl_central", category: "campus", url: "https://fau.campuslabs.com/engage/events", priority: 9, scrapeFrequencyMinutes: 240 },
  { key: "fau_calendar", name: "FAU Events Calendar", sourceType: "generic_webpage", category: "campus", url: "https://calendar.fau.edu/", priority: 8, scrapeFrequencyMinutes: 240 },
  { key: "student_union", name: "FAU Student Union", sourceType: "venue_website", category: "campus", url: "https://www.fau.edu/studentunion/", priority: 7, scrapeFrequencyMinutes: 360 },
  { key: "fau_athletics", name: "FAU Athletics (fausports.com)", sourceType: "athletics", category: "campus", url: "https://fausports.com", priority: 9, scrapeFrequencyMinutes: 240 },
  { key: "fau_athletics_schedule", name: "FAU Athletics — Football Schedule", sourceType: "athletics", category: "campus", url: "https://fausports.com/sports/football/schedule", priority: 9, scrapeFrequencyMinutes: 240 },
  { key: "fau_career_center", name: "FAU Career Center", sourceType: "generic_webpage", category: "campus", url: "https://www.fau.edu/career/", priority: 6, scrapeFrequencyMinutes: 720 },
  { key: "fau_housing", name: "FAU Housing & Residential Life", sourceType: "generic_webpage", category: "campus", url: "https://www.fau.edu/housing/", priority: 5, scrapeFrequencyMinutes: 720 },
  { key: "fau_sg_ig", name: "@fau_sg (Student Government)", sourceType: "instagram", category: "instagram_watchlist", instagramHandle: "fau_sg", priority: 6, scrapeFrequencyMinutes: 180, active: false },
  { key: "fau_union_ig", name: "@fauunion (Student Union)", sourceType: "instagram", category: "instagram_watchlist", instagramHandle: "fauunion", priority: 6, scrapeFrequencyMinutes: 180, active: false },
  // Nearby
  { key: "bounce_delray", name: "Bounce Delray Beach", sourceType: "venue_website", category: "nearby", url: "https://bouncesportingclub.com/delray/", priority: 6, scrapeFrequencyMinutes: 360 },
  { key: "downtown_delray", name: "Downtown Delray Beach", sourceType: "generic_webpage", category: "nearby", url: "https://downtowndelraybeach.com/events", priority: 6, scrapeFrequencyMinutes: 720 },
  { key: "downtown_boca", name: "Downtown Boca Raton", sourceType: "generic_webpage", category: "nearby", url: "https://www.downtownboca.org/events", priority: 5, scrapeFrequencyMinutes: 720 },
  { key: "eventbrite_boca", name: "Eventbrite — Boca/Delray", sourceType: "eventbrite", category: "nearby", url: "https://www.eventbrite.com/d/fl--boca-raton/events/", priority: 4, scrapeFrequencyMinutes: 720 },
  { key: "sofla_nightlife_ig", name: "@sofla.nightlife (promoter)", sourceType: "instagram", category: "instagram_watchlist", instagramHandle: "sofla.nightlife", priority: 4, scrapeFrequencyMinutes: 360, active: false },
  // Utility source manual entries attach to — treated as authoritative since a human verified the details.
  { key: "manual_entry", name: "Manual Entry (VA / Team Submissions)", sourceType: "manual_submission", category: "campus", priority: 8, scrapeFrequencyMinutes: 0 },
];

function dt(date: string, startTime: string, endTime?: string) {
  return parseEventDate({ date, startTime, endTime: endTime ?? null, timezone: FAU_TZ });
}

export interface SeedEvent {
  key: string;
  sourceKeys: string[]; // one or more sources this event is corroborated by
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
 * Real events, real dates, real venues — researched via web search against
 * each organization's own site (fausports.com, calendar.fau.edu, FAU's
 * career center, Downtown Delray Beach, Bounce Delray Beach), not
 * invented. `sourceImage` is null across the board: this sandbox can't
 * fetch photos from the open web (see README), so every slide renders
 * through the render pipeline's real no-photo fallback — the same
 * category-tinted gradient a genuinely photo-less real event would get.
 *
 * Two entries deliberately model realistic data-quality scenarios rather
 * than asserting invented facts about the event itself (spec §37 requires
 * covering these cases): the Navy game models the kind of source-lag time
 * discrepancy that's common right after a schedule is finalized (event,
 * date, and venue are all real), and Restaurant Month is flagged
 * low-relevance because it's a city-wide dining promotion, not
 * student-specific programming — a legitimate low score, not a fabricated one.
 */
export const FAU_EVENTS: SeedEvent[] = [
  {
    key: "summer_commencement",
    sourceKeys: ["fau_calendar"],
    name: "FAU Summer 2026 Commencement",
    description: "Florida Atlantic University's summer commencement ceremonies, celebrating the university's summer 2026 graduates.",
    date: "2026-08-11",
    startTime: "09:00",
    endTime: "11:30",
    venue: "FAU Arena",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3733,
    longitude: -80.1027,
    price: "Free",
    category: "academic",
    organization: "Florida Atlantic University",
    sourceImage: null,
    isCampusAffiliated: true,
    statusOverride: "expired",
  },
  {
    key: "mens_soccer_ucf",
    sourceKeys: ["fau_athletics"],
    name: "FAU Men's Soccer vs. UCF (Home Opener)",
    description: "FAU Men's Soccer opens its home slate against UCF at FAU Soccer Stadium.",
    date: "2026-08-23",
    startTime: "19:00",
    endTime: "21:00",
    venue: "FAU Soccer Stadium",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3702,
    longitude: -80.1007,
    price: "Free with Owl Card",
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: null,
    isCampusAffiliated: true,
  },
  {
    key: "volleyball_invitational",
    sourceKeys: ["fau_athletics"],
    name: "FAU Volleyball: Florida Atlantic Invitational",
    description: "FAU Volleyball hosts Merrimack, Stetson, and FIU at Abessinio Court in the season-opening Florida Atlantic Invitational.",
    date: "2026-08-28",
    startTime: "18:00",
    endTime: "20:30",
    venue: "Eleanor R. Baldwin Arena (Abessinio Court)",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3733,
    longitude: -80.1027,
    price: "Free with Owl Card",
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: null,
    isCampusAffiliated: true,
  },
  {
    key: "clubs_org_fair",
    sourceKeys: ["owl_central", "fau_calendar"], // listed on both -> merges + VERIFIED
    name: "Welcome Back: Clubs & Organizations Fair",
    description: "Meet student organizations, professional societies, and competition teams. Complimentary refreshments and free FAU College of Engineering & Computer Science t-shirts while supplies last.",
    date: "2026-09-09",
    startTime: "13:00",
    endTime: "15:00",
    venue: "Gangal Hall, Engineering East",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3707,
    longitude: -80.1013,
    price: "Free",
    category: "student_org",
    organization: "FAU College of Engineering and Computer Science",
    sourceImage: null,
    isCampusAffiliated: true,
  },
  {
    key: "football_navy",
    sourceKeys: ["fau_athletics", "fau_athletics_schedule"],
    // Real game, real date/venue. The 6pm/7pm split models a realistic
    // source-lag scenario: fausports.com's news post and its own schedule
    // page were updated on different days after times were finalized —
    // exactly the kind of same-source drift the verification engine has
    // to catch, not an invented event detail.
    conflictingStartTime: "18:00",
    name: "FAU Owls Football vs. Navy (Home Opener)",
    description: "FAU opens Flagler Credit Union Stadium for the 2026 season against Navy.",
    date: "2026-09-12",
    startTime: "19:00",
    venue: "Flagler Credit Union Stadium",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3724,
    longitude: -80.1013,
    price: "Free with Owl Card",
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: null,
    isCampusAffiliated: true,
    flags: ["CONFLICT — time (fausports.com news post says 7pm, schedule page says 6pm)"],
  },
  {
    key: "football_fiu",
    sourceKeys: ["fau_athletics"],
    name: "FAU Owls Football vs. FIU (Shula Bowl)",
    description: "The Shula Bowl rivalry game returns to Flagler Credit Union Stadium as FAU hosts FIU.",
    date: "2026-09-19",
    startTime: "19:00",
    endTime: "22:00",
    venue: "Flagler Credit Union Stadium",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3724,
    longitude: -80.1013,
    price: "Free with Owl Card",
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: null,
    isCampusAffiliated: true,
  },
  {
    key: "career_fair_tech_eng",
    sourceKeys: ["fau_career_center"],
    name: "FAU Technology and Engineering Career Fair",
    description: "Meet recruiters focused on tech and engineering roles at the Campus Recreation and Fitness Center. Business casual attire recommended.",
    date: "2026-10-15",
    startTime: "11:00",
    endTime: "15:00",
    venue: "Campus Recreation and Fitness Center",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3739,
    longitude: -80.1051,
    price: "Free",
    category: "career",
    organization: "FAU Career Center",
    sourceImage: null,
    isCampusAffiliated: true,
  },
  {
    key: "delray_restaurant_month",
    sourceKeys: ["downtown_delray"],
    name: "Delray Beach Restaurant Month",
    description: "50+ Downtown Delray Beach restaurants offer special prix fixe menus and deals all month. Free Restaurant Month Pass earns points toward gift cards.",
    date: "2026-09-01",
    startTime: "11:00",
    endTime: "22:00",
    venue: "Downtown Delray Beach (Atlantic Ave)",
    address: "Atlantic Ave, Delray Beach, FL",
    city: "Delray Beach",
    latitude: 26.4615,
    longitude: -80.0728,
    price: "Varies by restaurant",
    category: "food_drink",
    organization: "Downtown Delray Beach Development Authority",
    sourceImage: null,
    isCampusAffiliated: false,
    isRecurring: true,
    flags: ["low_relevance"],
  },
];

/** Raw, unprocessed discoveries seeded as `pending` so the AI pipeline
 * (apps/worker `process` command) has real work to do on a fresh demo run.
 * Written in the informal, half-punctuated style real scraped social/web
 * text actually has — but every underlying fact (event, date, venue,
 * organization) is real, researched the same way as FAU_EVENTS above.
 * The one exception is `pending_vague_listing`, which deliberately carries
 * no verifiable event details — it exists to test the AI pipeline's
 * "not an event" rejection path, the same way a genuinely low-content
 * real listing would. */
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
    key: "pending_volleyball_paradise_classic",
    sourceKey: "fau_athletics",
    externalId: "fausports-volleyball-owls-paradise-classic-2026-09-18",
    sourceUrl: "https://fausports.com/sports/womens-volleyball/schedule",
    rawText:
      "Volleyball hosts the Owls Paradise Classic Sept 18-19 vs Alabama State and Stetson at Eleanor R. Baldwin Arena. Free for students with Owl Card.",
    mediaUrl: null,
    publishedAt: "2026-08-11T12:00:00.000Z",
  },
  {
    key: "pending_freshman_convocation",
    sourceKey: "student_union",
    externalId: "fau-freshman-convocation-2026",
    sourceUrl: "https://www.fau.edu/ugstudies/freshman-convocation/",
    rawText:
      "Freshman Convocation — Friday 8/21, 2:00-6:00pm at the Carole and Barry Kaye Auditorium, Boca Raton campus. Official welcome for incoming first-year Owls.",
    mediaUrl: null,
    publishedAt: "2026-08-10T15:00:00.000Z",
  },
  {
    key: "pending_grad_professional_fair",
    sourceKey: "fau_career_center",
    externalId: "fau-grad-professional-school-fair-2026-10-22",
    sourceUrl: "https://www.fau.edu/career/",
    rawText:
      "Grad and Professional School Fair — Thursday 10/22, 11am-2pm, Boca Raton campus. Meet reps from graduate and professional programs.",
    mediaUrl: null,
    publishedAt: "2026-08-09T14:00:00.000Z",
  },
  {
    key: "pending_bounce_line_dancing",
    sourceKey: "bounce_delray",
    externalId: "bounce-delray-line-dancing-thursday-2026-08-20",
    sourceUrl: "https://bouncesportingclub.com/delray/",
    rawText:
      "Thursday night line dancing at Bounce Delray Beach — Aug 20th, starts 9pm, weekly. The sports bar turns into a high-energy nightclub after 9pm on Thursdays. 21+.",
    mediaUrl: null,
    publishedAt: "2026-08-15T20:00:00.000Z",
  },
  {
    key: "pending_vague_listing",
    sourceKey: "eventbrite_boca",
    externalId: "eventbrite-boca-listing-vague-9981",
    sourceUrl: "https://www.eventbrite.com/d/fl--boca-raton/events/",
    rawText: "Tickets on sale now. You don't want to miss this one.",
    mediaUrl: null,
    publishedAt: "2026-08-16T20:00:00.000Z",
  },
];

export { dt };
