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
}

export const FAU_SOURCES: SeedSource[] = [
  // Campus
  { key: "owl_central", name: "Owl Central", sourceType: "owl_central", category: "campus", url: "https://fau.campuslabs.com/engage/events", priority: 9, scrapeFrequencyMinutes: 240 },
  { key: "student_union", name: "FAU Student Union", sourceType: "venue_website", category: "campus", url: "https://www.fau.edu/studentunion/", priority: 7, scrapeFrequencyMinutes: 360 },
  { key: "fau_athletics", name: "FAU Athletics (fauowls.com)", sourceType: "athletics", category: "campus", url: "https://fauowls.com", priority: 9, scrapeFrequencyMinutes: 240 },
  { key: "fau_athletics_schedule", name: "FAU Athletics — Official Schedule Feed", sourceType: "ical", category: "campus", url: "https://fauowls.com/schedule.ics", priority: 9, scrapeFrequencyMinutes: 240 },
  { key: "fau_housing", name: "FAU Housing & Residential Life", sourceType: "generic_webpage", category: "campus", url: "https://www.fau.edu/housing/", priority: 5, scrapeFrequencyMinutes: 720 },
  { key: "fau_sg_ig", name: "@fau_sg (Student Government)", sourceType: "instagram", category: "instagram_watchlist", instagramHandle: "fau_sg", priority: 6, scrapeFrequencyMinutes: 180 },
  { key: "fau_union_ig", name: "@fauunion (Student Union)", sourceType: "instagram", category: "instagram_watchlist", instagramHandle: "fauunion", priority: 6, scrapeFrequencyMinutes: 180 },
  // Nearby
  { key: "bounce_delray", name: "Bounce Delray Beach", sourceType: "venue_website", category: "nearby", url: "https://boundelray.com", priority: 6, scrapeFrequencyMinutes: 360 },
  { key: "the_break_boca", name: "The Break Boca", sourceType: "instagram", category: "instagram_watchlist", instagramHandle: "thebreakboca", priority: 5, scrapeFrequencyMinutes: 360 },
  { key: "boca_downtown", name: "Downtown Boca Raton Events", sourceType: "generic_webpage", category: "nearby", url: "https://www.downtownboca.org/events", priority: 6, scrapeFrequencyMinutes: 720 },
  { key: "eventbrite_boca", name: "Eventbrite — Boca/Delray", sourceType: "eventbrite", category: "nearby", url: "https://www.eventbrite.com/d/fl--boca-raton/events/", priority: 4, scrapeFrequencyMinutes: 720 },
  { key: "miami_sports_rss", name: "South Florida Pro Sports RSS", sourceType: "rss", category: "nearby", url: "https://example.com/sfl-sports.rss", priority: 6, scrapeFrequencyMinutes: 720 },
  { key: "ftl_promoter_ig", name: "@sofla.nightlife (promoter)", sourceType: "instagram", category: "instagram_watchlist", instagramHandle: "sofla.nightlife", priority: 4, scrapeFrequencyMinutes: 360 },
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

// distances are approximate straight-line miles from FAU Boca campus
export const FAU_EVENTS: SeedEvent[] = [
  {
    key: "involvement_fair",
    sourceKeys: ["owl_central", "fau_union_ig"], // appears on 2 sources -> merges + VERIFIED
    name: "FAU Fall Involvement Fair",
    description: "Meet 100+ student organizations, grab free swag, and sign up for clubs at the Student Union Breezeway.",
    date: "2026-08-24",
    startTime: "17:00",
    endTime: "19:30",
    venue: "Student Union Breezeway",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3707,
    longitude: -80.1013,
    price: "Free",
    category: "campus",
    organization: "FAU Student Involvement",
    sourceImage: "involvement_fair.jpg",
    isCampusAffiliated: true,
  },
  {
    key: "football_gsu",
    sourceKeys: ["fau_athletics"],
    name: "FAU Owls Football vs. Georgia Southern",
    description: "Tailgate at 4pm, kickoff at 7pm. Students get in free with a valid Owl Card.",
    date: "2026-08-22",
    startTime: "19:00",
    endTime: "22:00",
    venue: "FAU Stadium (Flagler Credit Union Stadium)",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3724,
    longitude: -80.1013,
    price: "Free with Owl Card",
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: "football_gsu.jpg",
    isCampusAffiliated: true,
  },
  {
    key: "mizner_sunset_sessions",
    sourceKeys: ["boca_downtown"],
    name: "Sunset Sessions Live at Mizner Park",
    description: "Free outdoor concert series featuring local South Florida artists, food trucks, and lawn seating.",
    date: "2026-08-28",
    startTime: "19:00",
    endTime: "22:00",
    venue: "Mizner Park Amphitheater",
    address: "590 Plaza Real, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3536,
    longitude: -80.0836,
    price: "Free",
    category: "concert",
    organization: "Mizner Park",
    sourceImage: "mizner_sunset_sessions.jpg",
    isCampusAffiliated: false,
  },
  {
    key: "bounce_college_night",
    sourceKeys: ["bounce_delray"],
    name: "College Night at Bounce Delray",
    description: "Back-to-school nightlife event with resident DJ, drink specials, and free entry before 11pm for students.",
    date: "2026-08-21",
    startTime: "22:00",
    endTime: "02:00",
    venue: "Bounce Delray Beach",
    address: "217 E Atlantic Ave, Delray Beach, FL",
    city: "Delray Beach",
    latitude: 26.4615,
    longitude: -80.0728,
    price: "Free before 11",
    ageRequirement: "21+",
    category: "nightlife",
    organization: "Bounce Delray Beach",
    sourceImage: "bounce_college_night.jpg",
    isCampusAffiliated: false,
  },
  {
    key: "basketball_ucf_conflict",
    sourceKeys: ["fau_athletics", "fau_athletics_schedule"],
    conflictingStartTime: "18:00", // second observation disagrees -> CONFLICT
    name: "FAU Owls Basketball vs. UCF",
    description: "Home conference matchup at Eleanor R. Baldwin Arena.",
    date: "2026-09-02",
    startTime: "19:00",
    venue: "Eleanor R. Baldwin Arena",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3733,
    longitude: -80.1027,
    price: "Free with Owl Card",
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: "basketball_ucf.jpg",
    isCampusAffiliated: true,
    flags: ["CONFLICT — time (article says 7pm, schedule says 6pm)"],
  },
  {
    key: "study_break_coffee",
    sourceKeys: ["owl_central"],
    name: "Owl Central Study Break: Free Coffee & Snacks",
    description: "Grab free coffee and snacks in the library breezeway before midterms week.",
    date: "2026-08-25",
    startTime: "10:00",
    endTime: "13:00",
    venue: "S.E. Wimberly Library Breezeway",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3719,
    longitude: -80.1027,
    price: "Free",
    category: "campus",
    organization: "FAU Student Government",
    sourceImage: null, // deliberately no image — tests the "no image" rendering fallback
    isCampusAffiliated: true,
  },
  {
    key: "spring_kickoff_concert_expired",
    sourceKeys: ["student_union"],
    name: "Spring Kickoff Concert",
    description: "Live performances, food trucks, and giveaways to kick off the spring semester.",
    date: "2026-08-05", // in the past relative to seed run date
    startTime: "18:00",
    endTime: "21:00",
    venue: "Live Oak Pavilion",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3707,
    longitude: -80.1013,
    price: "Free",
    category: "campus",
    organization: "FAU Student Union",
    sourceImage: "spring_kickoff.jpg",
    isCampusAffiliated: true,
    statusOverride: "expired",
  },
  {
    key: "miami_finance_networking_low_relevance",
    sourceKeys: ["eventbrite_boca"],
    name: "Miami Finance Professionals Networking Mixer",
    description: "A recurring weekly networking mixer for finance professionals in Brickell.",
    date: "2026-08-27",
    startTime: "18:00",
    endTime: "20:00",
    venue: "Brickell Rooftop Lounge",
    address: "1000 Brickell Ave, Miami, FL",
    city: "Miami",
    latitude: 25.7617,
    longitude: -80.1918,
    price: "$25",
    category: "networking",
    organization: "SFL Finance Network",
    sourceImage: "finance_mixer.jpg",
    isCampusAffiliated: false,
    isRecurring: true,
    flags: ["low_relevance"],
  },
  {
    key: "career_fair",
    sourceKeys: ["owl_central"],
    name: "FAU Fall Career Fair",
    description: "Meet recruiters from 80+ companies. Business casual attire, resumes recommended.",
    date: "2026-08-26",
    startTime: "11:00",
    endTime: "15:00",
    venue: "FAU Arena Concourse",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3733,
    longitude: -80.1027,
    price: "Free",
    category: "career",
    organization: "FAU Career Center",
    sourceImage: "career_fair.jpg",
    isCampusAffiliated: true,
  },
  {
    key: "heat_celtics",
    sourceKeys: ["miami_sports_rss"],
    name: "Miami Heat vs. Boston Celtics",
    description: "Preseason matchup at Kaseya Center. Watch parties encouraged for students who can't make the drive.",
    date: "2026-09-05",
    startTime: "19:30",
    endTime: "22:00",
    venue: "Kaseya Center",
    address: "601 Biscayne Blvd, Miami, FL",
    city: "Miami",
    latitude: 25.7814,
    longitude: -80.187,
    price: "$40",
    category: "sports",
    organization: "Miami Heat",
    sourceImage: "heat_celtics.jpg",
    isCampusAffiliated: false,
  },
  {
    key: "run_club_5k",
    sourceKeys: ["boca_downtown"],
    name: "FAU Run Club Sunrise 5K",
    description: "Casual weekly 5K around campus, all paces welcome. Meet at the rec center entrance.",
    date: "2026-08-23",
    startTime: "07:00",
    endTime: "08:00",
    venue: "FAU Recreation & Wellness Center",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3739,
    longitude: -80.1051,
    price: "Free",
    category: "fitness",
    organization: "FAU Run Club",
    sourceImage: "run_club.jpg",
    isCampusAffiliated: true,
    isRecurring: true,
  },
  {
    key: "delray_bar_crawl",
    sourceKeys: ["ftl_promoter_ig"],
    name: "Downtown Delray Bar Crawl",
    description: "Hit five bars along Atlantic Ave with one wristband. DJs, drink specials, and photo ops all night.",
    date: "2026-08-29",
    startTime: "21:00",
    endTime: "01:00",
    venue: "Atlantic Ave, Delray Beach",
    address: "Atlantic Ave, Delray Beach, FL",
    city: "Delray Beach",
    latitude: 26.4614,
    longitude: -80.0728,
    price: "$15",
    ageRequirement: "21+",
    category: "nightlife",
    organization: "SoFlo Bar Crawls",
    sourceImage: "bar_crawl.jpg",
    isCampusAffiliated: false,
  },
  {
    key: "volleyball_fiu",
    sourceKeys: ["fau_athletics"],
    name: "FAU Owls Volleyball vs. FIU",
    description: "Rivalry match at home. First 100 students get a free t-shirt.",
    date: "2026-08-27",
    startTime: "18:00",
    endTime: "20:00",
    venue: "Eleanor R. Baldwin Arena",
    address: "777 Glades Rd, Boca Raton, FL",
    city: "Boca Raton",
    latitude: 26.3733,
    longitude: -80.1027,
    price: "Free with Owl Card",
    category: "sports",
    organization: "FAU Athletics",
    sourceImage: "volleyball_fiu.jpg",
    isCampusAffiliated: true,
  },
];

/** Raw, unprocessed discoveries seeded as `pending` so the AI pipeline
 * (apps/worker `process` command) has real work to do on a fresh demo run. */
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
    key: "pending_bounce_flyer",
    sourceKey: "bounce_delray",
    externalId: "bounce-2026-09-04-throwback",
    sourceUrl: "https://boundelray.com/events/throwback-thursday",
    rawText:
      "THROWBACK THURSDAY 🎶 Sept 4th at Bounce Delray Beach. 2000s/2010s hits all night with DJ Marz. Doors 10pm, free before 11pm, $10 after. 21+.",
    mediaUrl: "https://example.com/media/bounce-throwback.jpg",
    publishedAt: "2026-08-15T14:00:00.000Z",
  },
  {
    key: "pending_owl_central_yoga",
    sourceKey: "owl_central",
    externalId: "owlcentral-evt-88213",
    sourceUrl: "https://fau.campuslabs.com/engage/event/88213",
    rawText:
      "Sunset Yoga on the Green — Wednesday 8/26, 6:00-7:00pm, hosted by FAU Recreation Services. Free, mats provided while supplies last. All levels welcome.",
    mediaUrl: "https://example.com/media/sunset-yoga.jpg",
    publishedAt: "2026-08-14T18:30:00.000Z",
  },
  {
    key: "pending_union_ig_giveaway",
    sourceKey: "fau_union_ig",
    externalId: "ig-fauunion-postid-3021",
    sourceUrl: "https://instagram.com/p/fauunion-3021",
    rawText:
      "Free ice cream social this Friday 8/28 at 2pm outside the Student Union! Come cool off before the weekend 🍦",
    mediaUrl: "https://example.com/media/ice-cream-social.jpg",
    publishedAt: "2026-08-16T13:00:00.000Z",
  },
  {
    key: "pending_promoter_generic_post",
    sourceKey: "ftl_promoter_ig",
    externalId: "ig-soflanightlife-postid-9981",
    sourceUrl: "https://instagram.com/p/soflanightlife-9981",
    rawText: "link in bio for tickets 🔥🔥🔥 you don't want to miss this one",
    mediaUrl: "https://example.com/media/generic-promo.jpg",
    publishedAt: "2026-08-16T20:00:00.000Z",
  },
  {
    key: "pending_athletics_soccer",
    sourceKey: "fau_athletics",
    externalId: "fauowls-soccer-2026-09-06",
    sourceUrl: "https://fauowls.com/sports/soccer/schedule/2026-09-06",
    rawText:
      "FAU Soccer hosts Charlotte on Sunday, September 6th at 1:00 PM at FAU Soccer Stadium. Free admission for students with Owl Card.",
    mediaUrl: "https://example.com/media/soccer-charlotte.jpg",
    publishedAt: "2026-08-13T12:00:00.000Z",
  },
  {
    key: "pending_boca_downtown_market",
    sourceKey: "boca_downtown",
    externalId: "downtownboca-greenmarket-0906",
    sourceUrl: "https://www.downtownboca.org/events/greenmarket-0906",
    rawText:
      "GreenMarket at Royal Palm Place returns Sunday, Sept 6th, 9am-1pm. Local produce, live music, and family activities. Free to attend.",
    mediaUrl: "https://example.com/media/greenmarket.jpg",
    publishedAt: "2026-08-12T09:00:00.000Z",
  },
];

export { dt };
