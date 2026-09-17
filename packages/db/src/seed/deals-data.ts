import type { DealSourceType, MerchantCategory, MerchantTier, ScrapingMethod } from "@college-events/core";

export const UCF_TZ = "America/New_York";

/**
 * UCF as the first "University" row (spec Phase 1). All deals-specific
 * fields live directly on the shared `schools` tenant table — see
 * docs/DEALS_ARCHITECTURE.md §1 for why a school IS a university here.
 */
export const UCF_SCHOOL = {
  name: "University of Central Florida",
  shortName: "UCF",
  city: "Orlando",
  state: "FL",
  latitude: 28.6024,
  longitude: -81.2001,
  timezone: UCF_TZ,
  active: true,
  branding: {
    primaryColor: "#000000", // UCF black, inspired-by — not the official Pantone
    secondaryColor: "#BA9B37", // UCF gold
    accentColor: "#FFFFFF",
    backgroundColor: "#0B0B0F",
    fontFamily: "Anton, Helvetica, Arial, sans-serif",
  },
  // defaultRadiusMiles/weeklySchedule/instagramAccount are Events-product
  // fields on the shared schools table; UCF has no Events presence, so they
  // stay at safe defaults rather than being repurposed for Deals.
  defaultRadiusMiles: 7,
  weeklySchedule: [] as const,
  instagramAccount: null,
  studentPopulation: 69000,
  primaryRadiusMiles: 5,
  secondaryRadiusMiles: 7,
  commercialCorridors: [
    "University Blvd",
    "N Alafaya Trail / SR-434",
    "E Colonial Dr (SR-50)",
    "Knights Plaza / N Gemini Blvd",
    "Waterford Lakes Town Center",
  ],
  dealsInstagramAccount: "@ucf.deals",
} as const;

export interface SeedMerchantSource {
  key: string;
  sourceType: DealSourceType;
  sourceUrl: string;
  monitorFrequencyHours: number;
  scrapingMethod: ScrapingMethod;
  notes?: string;
}

export interface SeedMerchant {
  key: string;
  name: string;
  category: MerchantCategory;
  subcategory?: string;
  streetAddress: string;
  latitude: number;
  longitude: number;
  estimatedDriveTimeMinutes: number;
  studentRelevanceScore: number;
  monitoringTier: MerchantTier;
  discoverySource: string;
  website?: string;
  instagramUrl?: string;
  sources: SeedMerchantSource[];
}

/**
 * First tranche toward the 50-150 merchant universe (spec Phase 2/19):
 * ~34 real/well-documented UCF-area businesses, grounded in live search
 * results where noted, spanning the required category mix. Coordinates are
 * best-effort estimates along known corridors (University Blvd/Alafaya
 * Trail/E Colonial Dr), not survey-precision geocoding — see
 * docs/DEALS_ARCHITECTURE.md Risk #1: spot-check before a live posting
 * cycle. A handful of merchants without a confirmed official specials URL
 * are seeded as `scrapingMethod: "manual"` with a note rather than a
 * fabricated source, per spec Phase 3's "flag it, don't fake it" rule.
 */
export const UCF_MERCHANTS: SeedMerchant[] = [
  // ── University Blvd corridor (Tier A, <1.5mi) ──────────────────────
  {
    key: "lazy-moon-pizza",
    name: "Lazy Moon Pizza",
    category: "pizza",
    streetAddress: "11551 University Blvd, Orlando, FL 32817",
    latitude: 28.5991,
    longitude: -81.1975,
    estimatedDriveTimeMinutes: 4,
    studentRelevanceScore: 82,
    monitoringTier: "A",
    discoverySource: "web-research: TastyChomps UCF area dining guide",
    website: "https://www.lazymoonpizza.com",
    sources: [
      { key: "lazy-moon-site", sourceType: "official_website", sourceUrl: "https://www.lazymoonpizza.com", monitorFrequencyHours: 24, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "jimmy-hulas",
    name: "Jimmy Hula's",
    category: "fast_casual",
    subcategory: "fish tacos",
    streetAddress: "11544 University Blvd, Orlando, FL 32817",
    latitude: 28.5988,
    longitude: -81.1971,
    estimatedDriveTimeMinutes: 4,
    studentRelevanceScore: 78,
    monitoringTier: "A",
    discoverySource: "web-research: near-UCF restaurant search",
    website: "https://jimmyhulas.com",
    sources: [
      { key: "jimmy-hulas-site", sourceType: "official_website", sourceUrl: "https://jimmyhulas.com", monitorFrequencyHours: 24, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "freddys",
    name: "Freddy's Frozen Custard & Steakburgers",
    category: "fast_casual",
    streetAddress: "11762 University Blvd, Orlando, FL 32817",
    latitude: 28.5980,
    longitude: -81.1960,
    estimatedDriveTimeMinutes: 5,
    studentRelevanceScore: 80,
    monitoringTier: "A",
    discoverySource: "web-research: Orlando Weekly student discount roundup",
    website: "https://freddys.com",
    sources: [
      { key: "freddys-site", sourceType: "official_website", sourceUrl: "https://freddys.com/locations/", monitorFrequencyHours: 24, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "4-rivers-smokehouse",
    name: "4 Rivers Smokehouse",
    category: "restaurant",
    subcategory: "BBQ",
    streetAddress: "11780 University Blvd, Orlando, FL 32817",
    latitude: 28.5977,
    longitude: -81.1955,
    estimatedDriveTimeMinutes: 5,
    studentRelevanceScore: 76,
    monitoringTier: "A",
    discoverySource: "web-research: Orlando Weekly student discount roundup",
    website: "https://4rsmokehouse.com",
    sources: [
      { key: "4rivers-site", sourceType: "official_website", sourceUrl: "https://4rsmokehouse.com", monitorFrequencyHours: 24, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "buffalo-wild-wings",
    name: "Buffalo Wild Wings",
    category: "wings",
    streetAddress: "11951 University Blvd, Orlando, FL 32817",
    latitude: 28.5972,
    longitude: -81.1948,
    estimatedDriveTimeMinutes: 5,
    studentRelevanceScore: 79,
    monitoringTier: "A",
    discoverySource: "web-research: Orlando Weekly student discount roundup",
    website: "https://www.buffalowildwings.com",
    sources: [
      { key: "bww-site", sourceType: "promotions_page", sourceUrl: "https://www.buffalowildwings.com/en/deals", monitorFrequencyHours: 24, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "chipotle",
    name: "Chipotle Mexican Grill",
    category: "fast_casual",
    streetAddress: "11890 University Blvd, Orlando, FL 32817",
    latitude: 28.5975,
    longitude: -81.1950,
    estimatedDriveTimeMinutes: 5,
    studentRelevanceScore: 74,
    monitoringTier: "B",
    discoverySource: "national-chain proximity match (spec Phase 15 pattern)",
    website: "https://www.chipotle.com",
    sources: [
      { key: "chipotle-site", sourceType: "promotions_page", sourceUrl: "https://www.chipotle.com/rewards-and-promos", monitorFrequencyHours: 48, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "wingstop",
    name: "Wingstop",
    category: "wings",
    streetAddress: "11500 University Blvd, Orlando, FL 32817",
    latitude: 28.5970,
    longitude: -81.1945,
    estimatedDriveTimeMinutes: 5,
    studentRelevanceScore: 75,
    monitoringTier: "A",
    discoverySource: "category search: wings near UCF",
    website: "https://www.wingstop.com",
    sources: [
      { key: "wingstop-site", sourceType: "promotions_page", sourceUrl: "https://www.wingstop.com/deals", monitorFrequencyHours: 24, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "dunkin",
    name: "Dunkin'",
    category: "coffee_boba",
    streetAddress: "11500 University Blvd, Orlando, FL 32817",
    latitude: 28.5988,
    longitude: -81.1970,
    estimatedDriveTimeMinutes: 4,
    studentRelevanceScore: 70,
    monitoringTier: "A",
    discoverySource: "category search: coffee near UCF",
    website: "https://www.dunkindonuts.com",
    sources: [
      { key: "dunkin-site", sourceType: "promotions_page", sourceUrl: "https://www.dunkindonuts.com/en/offers", monitorFrequencyHours: 48, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "jersey-mikes",
    name: "Jersey Mike's Subs",
    category: "fast_casual",
    streetAddress: "11640 University Blvd, Orlando, FL 32817",
    latitude: 28.5978,
    longitude: -81.1958,
    estimatedDriveTimeMinutes: 5,
    studentRelevanceScore: 72,
    monitoringTier: "B",
    discoverySource: "web-research: student-ID sub shop deal near University Shoppes",
    website: "https://www.jerseymikes.com",
    sources: [
      { key: "jersey-mikes-site", sourceType: "official_website", sourceUrl: "https://www.jerseymikes.com", monitorFrequencyHours: 48, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "bubbalous",
    name: "Bubbalou's Bodacious Bar-B-Q",
    category: "restaurant",
    subcategory: "BBQ",
    streetAddress: "5250 N Alafaya Trail, Orlando, FL 32826",
    latitude: 28.5920,
    longitude: -81.2035,
    estimatedDriveTimeMinutes: 6,
    studentRelevanceScore: 68,
    monitoringTier: "B",
    discoverySource: "web-research: Orlando BBQ chains near UCF",
    website: "https://www.bubbalous.com",
    sources: [
      { key: "bubbalous-site", sourceType: "official_website", sourceUrl: "https://www.bubbalous.com", monitorFrequencyHours: 48, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "kung-fu-tea",
    name: "Kung Fu Tea",
    category: "coffee_boba",
    streetAddress: "11838 University Blvd, Orlando, FL 32817",
    latitude: 28.5982,
    longitude: -81.1963,
    estimatedDriveTimeMinutes: 5,
    studentRelevanceScore: 73,
    monitoringTier: "A",
    discoverySource: "category search: boba near UCF",
    website: "https://www.kungfutea.com",
    sources: [
      { key: "kung-fu-tea-site", sourceType: "official_website", sourceUrl: "https://www.kungfutea.com", monitorFrequencyHours: 48, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "cold-stone",
    name: "Cold Stone Creamery",
    category: "dessert",
    streetAddress: "11838 University Blvd, Orlando, FL 32817",
    latitude: 28.5986,
    longitude: -81.1968,
    estimatedDriveTimeMinutes: 5,
    studentRelevanceScore: 66,
    monitoringTier: "B",
    discoverySource: "category search: dessert near UCF",
    website: "https://www.coldstonecreamery.com",
    sources: [
      { key: "cold-stone-site", sourceType: "official_website", sourceUrl: "https://www.coldstonecreamery.com", monitorFrequencyHours: 72, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "starbucks-su",
    name: "Starbucks (Student Union)",
    category: "coffee_boba",
    streetAddress: "4000 Central Florida Blvd, Orlando, FL 32816",
    latitude: 28.6015,
    longitude: -81.1995,
    estimatedDriveTimeMinutes: 2,
    studentRelevanceScore: 71,
    monitoringTier: "B",
    discoverySource: "UCF Student Union food & vendors page",
    website: "https://studentunion.ucf.edu/food-and-vendors/",
    sources: [
      { key: "starbucks-su-site", sourceType: "university_program" as DealSourceType, sourceUrl: "https://studentunion.ucf.edu/food-and-vendors/", monitorFrequencyHours: 72, scrapingMethod: "static_fetch" },
    ],
  },

  // ── N Alafaya Trail corridor near campus (Tier A/B, 1.5-2.5mi) ─────
  {
    key: "luya-bistro",
    name: "Luya Bistro",
    category: "restaurant",
    subcategory: "Chinese",
    streetAddress: "4192 N Alafaya Trail, Orlando, FL 32826",
    latitude: 28.5940,
    longitude: -81.2050,
    estimatedDriveTimeMinutes: 6,
    studentRelevanceScore: 70,
    monitoringTier: "B",
    discoverySource: "web-research: Nicholson Student Media 'Feasting on a budget around UCF'",
    sources: [
      {
        key: "luya-manual",
        sourceType: "manual",
        sourceUrl: "https://www.google.com/search?q=Luya+Bistro+Orlando+lunch+specials",
        monitorFrequencyHours: 168,
        scrapingMethod: "manual",
        notes: "No confirmed official site found during MVP seeding — MANUAL_SOURCE until a real specials/menu URL is verified (spec Phase 3).",
      },
    ],
  },
  {
    key: "bento-asian-kitchen",
    name: "Bento Asian Kitchen + Bar",
    category: "fast_casual",
    subcategory: "Asian fusion",
    streetAddress: "4001 N Alafaya Trail, Orlando, FL 32826",
    latitude: 28.5920,
    longitude: -81.2060,
    estimatedDriveTimeMinutes: 6,
    studentRelevanceScore: 68,
    monitoringTier: "B",
    discoverySource: "web-research: Nicholson Student Media 'Feasting on a budget around UCF'",
    sources: [
      {
        key: "bento-manual",
        sourceType: "manual",
        sourceUrl: "https://www.google.com/search?q=Bento+Asian+Kitchen+Orlando+Alafaya+specials",
        monitorFrequencyHours: 168,
        scrapingMethod: "manual",
        notes: "No confirmed official site found during MVP seeding — MANUAL_SOURCE until verified.",
      },
    ],
  },
  {
    key: "blaze-pizza",
    name: "Blaze Pizza",
    category: "pizza",
    streetAddress: "4041 N Alafaya Trail, Orlando, FL 32826",
    latitude: 28.5918,
    longitude: -81.2058,
    estimatedDriveTimeMinutes: 6,
    studentRelevanceScore: 74,
    monitoringTier: "A",
    discoverySource: "web-research: Nicholson Student Media 'Feasting on a budget around UCF'",
    website: "https://www.blazepizza.com",
    sources: [
      { key: "blaze-site", sourceType: "official_website", sourceUrl: "https://www.blazepizza.com", monitorFrequencyHours: 24, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "ahmed-indian",
    name: "Ahmed Indian Restaurant",
    category: "restaurant",
    subcategory: "Indian",
    streetAddress: "4110 N Alafaya Trail, Orlando, FL 32826",
    latitude: 28.5900,
    longitude: -81.2065,
    estimatedDriveTimeMinutes: 7,
    studentRelevanceScore: 69,
    monitoringTier: "B",
    discoverySource: "web-research: verified official site (ahmedindianrestaurant.com)",
    website: "https://ahmedindianrestaurant.com/ahmed-restaurant-ucf",
    sources: [
      { key: "ahmed-site", sourceType: "official_website", sourceUrl: "https://ahmedindianrestaurant.com/ahmed-restaurant-ucf", monitorFrequencyHours: 48, scrapingMethod: "static_fetch" },
    ],
  },

  // ── Knights Plaza, N Gemini Blvd (Tier A, on-campus adjacent) ──────
  {
    key: "gringos-locos",
    name: "Gringos Locos",
    category: "fast_casual",
    subcategory: "Tex-Mex",
    streetAddress: "Knights Plaza, N Gemini Blvd, Orlando, FL 32816",
    latitude: 28.6045,
    longitude: -81.1985,
    estimatedDriveTimeMinutes: 2,
    studentRelevanceScore: 77,
    monitoringTier: "A",
    discoverySource: "Knights Plaza tenant directory (Wikipedia)",
    website: "https://www.gringoslocos.com",
    sources: [
      { key: "gringos-site", sourceType: "official_website", sourceUrl: "https://www.gringoslocos.com", monitorFrequencyHours: 24, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "pop-parlour",
    name: "The Pop Parlour",
    category: "dessert",
    subcategory: "boba & popsicles",
    streetAddress: "Knights Plaza, N Gemini Blvd, Orlando, FL 32816",
    latitude: 28.6047,
    longitude: -81.1983,
    estimatedDriveTimeMinutes: 2,
    studentRelevanceScore: 75,
    monitoringTier: "A",
    discoverySource: "Knights Plaza tenant directory (Wikipedia)",
    website: "https://thepopparlour.com",
    sources: [
      { key: "pop-parlour-site", sourceType: "official_website", sourceUrl: "https://thepopparlour.com", monitorFrequencyHours: 24, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "subway-knights-plaza",
    name: "Subway (Knights Plaza)",
    category: "fast_casual",
    streetAddress: "Knights Plaza, N Gemini Blvd, Orlando, FL 32816",
    latitude: 28.6043,
    longitude: -81.1987,
    estimatedDriveTimeMinutes: 2,
    studentRelevanceScore: 60,
    monitoringTier: "B",
    discoverySource: "Knights Plaza tenant directory (Wikipedia)",
    website: "https://www.subway.com",
    sources: [
      { key: "subway-site", sourceType: "promotions_page", sourceUrl: "https://www.subway.com/en-us/menunutrition/menu/deals", monitorFrequencyHours: 48, scrapingMethod: "static_fetch" },
    ],
  },

  // ── On-campus dining/services ───────────────────────────────────────
  {
    key: "hueymagoos",
    name: "Huey Magoo's",
    category: "fast_casual",
    streetAddress: "4000 Central Florida Blvd, Orlando, FL 32816",
    latitude: 28.6020,
    longitude: -81.1998,
    estimatedDriveTimeMinutes: 2,
    studentRelevanceScore: 72,
    monitoringTier: "A",
    discoverySource: "UCF Student Union food & vendors page",
    website: "https://studentunion.ucf.edu/food-and-vendors/",
    sources: [
      { key: "hueymagoos-site", sourceType: "university_program" as DealSourceType, sourceUrl: "https://studentunion.ucf.edu/food-and-vendors/", monitorFrequencyHours: 72, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "knightcade",
    name: "Knightcade",
    category: "bowling_arcade",
    subcategory: "wings, pretzels & arcade",
    streetAddress: "4000 Central Florida Blvd, Orlando, FL 32816",
    latitude: 28.6022,
    longitude: -81.1996,
    estimatedDriveTimeMinutes: 2,
    studentRelevanceScore: 65,
    monitoringTier: "B",
    discoverySource: "UCF Student Union food & vendors page",
    website: "https://ucf.mydininghub.com/en/locations",
    sources: [
      { key: "knightcade-site", sourceType: "university_program" as DealSourceType, sourceUrl: "https://ucf.mydininghub.com/en/locations", monitorFrequencyHours: 72, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "college-optical-express",
    name: "College Optical Express",
    category: "retail",
    subcategory: "eyewear",
    streetAddress: "4000 Central Florida Blvd, Orlando, FL 32816",
    latitude: 28.6018,
    longitude: -81.1993,
    estimatedDriveTimeMinutes: 2,
    studentRelevanceScore: 50,
    monitoringTier: "C",
    discoverySource: "UCF Student Union food & vendors page",
    website: "https://www.collegeopticalexpress.com",
    sources: [
      { key: "college-optical-site", sourceType: "official_website", sourceUrl: "https://www.collegeopticalexpress.com", monitorFrequencyHours: 168, scrapingMethod: "static_fetch" },
    ],
  },

  // ── Beauty / barber / nails (Tier A/B) ─────────────────────────────
  {
    key: "revamp-ucf",
    name: "Revamp at UCF",
    category: "barber",
    streetAddress: "UCF Campus, Orlando, FL 32816",
    latitude: 28.6030,
    longitude: -81.1990,
    estimatedDriveTimeMinutes: 2,
    studentRelevanceScore: 71,
    monitoringTier: "A",
    discoverySource: "web-research: verified official site (revampucf.com)",
    website: "https://revampucf.com/",
    sources: [
      { key: "revamp-site", sourceType: "official_website", sourceUrl: "https://revampucf.com/", monitorFrequencyHours: 72, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "nail-lounge-ucf",
    name: "The Nail Lounge UCF",
    category: "nail_salon",
    streetAddress: "13781 E Colonial Dr STE F, Orlando, FL 32826",
    latitude: 28.5830,
    longitude: -81.2070,
    estimatedDriveTimeMinutes: 10,
    studentRelevanceScore: 58,
    monitoringTier: "B",
    discoverySource: "web-research: verified Fresha listing",
    website: "https://www.fresha.com/lvp/the-nail-lounge-ucf-east-colonial-drive-orlando-xXqb17",
    sources: [
      {
        key: "nail-lounge-fresha",
        sourceType: "official_website",
        sourceUrl: "https://www.fresha.com/lvp/the-nail-lounge-ucf-east-colonial-drive-orlando-xXqb17",
        monitorFrequencyHours: 168,
        scrapingMethod: "manual",
        notes: "Fresha booking pages render client-side via JS — flagged MANUAL_SOURCE rather than attempting a brittle scrape (spec Phase 3).",
      },
    ],
  },
  {
    key: "mancave-ucf",
    name: "ManCave For Men — Orlando UCF",
    category: "barber",
    streetAddress: "11891 University Blvd #150, Orlando, FL 32817",
    latitude: 28.5983,
    longitude: -81.1965,
    estimatedDriveTimeMinutes: 5,
    studentRelevanceScore: 62,
    monitoringTier: "B",
    discoverySource: "web-research: verified Fresha listing",
    website: "https://www.fresha.com/lvp/mancave-for-men-orlando-ucf-university-boulevard-orlando-nNw74V",
    sources: [
      {
        key: "mancave-fresha",
        sourceType: "official_website",
        sourceUrl: "https://www.fresha.com/lvp/mancave-for-men-orlando-ucf-university-boulevard-orlando-nNw74V",
        monitorFrequencyHours: 168,
        scrapingMethod: "manual",
        notes: "Fresha booking pages render client-side via JS — flagged MANUAL_SOURCE (spec Phase 3).",
      },
    ],
  },

  // ── Fitness (Tier B/C) ──────────────────────────────────────────────
  {
    key: "la-fitness-alafaya",
    name: "LA Fitness",
    category: "gym_fitness",
    streetAddress: "815 N Alafaya Trail, Orlando, FL 32828",
    latitude: 28.5820,
    longitude: -81.2085,
    estimatedDriveTimeMinutes: 10,
    studentRelevanceScore: 55,
    monitoringTier: "B",
    discoverySource: "web-research: verified LA Fitness club page",
    website: "https://www.lafitness.com/pages/clubhome.aspx?clubid=248",
    sources: [
      { key: "la-fitness-site", sourceType: "official_website", sourceUrl: "https://www.lafitness.com/pages/clubhome.aspx?clubid=248", monitorFrequencyHours: 72, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "orangetheory-ucf",
    name: "Orangetheory Fitness",
    category: "gym_fitness",
    streetAddress: "3122 N Alafaya Trail, Orlando, FL 32826",
    latitude: 28.5870,
    longitude: -81.2072,
    estimatedDriveTimeMinutes: 8,
    studentRelevanceScore: 52,
    monitoringTier: "C",
    discoverySource: "category search: fitness studios near UCF",
    website: "https://www.orangetheory.com",
    sources: [
      { key: "orangetheory-site", sourceType: "official_website", sourceUrl: "https://www.orangetheory.com", monitorFrequencyHours: 168, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "planet-fitness-waterford",
    name: "Planet Fitness (Waterford Lakes)",
    category: "gym_fitness",
    streetAddress: "638 N Alafaya Trl, Orlando, FL 32828",
    latitude: 28.5580,
    longitude: -81.2090,
    estimatedDriveTimeMinutes: 15,
    studentRelevanceScore: 48,
    monitoringTier: "C",
    discoverySource: "web-research: verified Planet Fitness club page",
    website: "https://www.planetfitness.com/gyms/orlando-waterford-lakes-fl/",
    sources: [
      { key: "planet-fitness-site", sourceType: "official_website", sourceUrl: "https://www.planetfitness.com/gyms/orlando-waterford-lakes-fl/", monitorFrequencyHours: 168, scrapingMethod: "static_fetch" },
    ],
  },

  // ── Entertainment (Tier B/C) ────────────────────────────────────────
  {
    key: "amc-waterford-lakes",
    name: "AMC Waterford Lakes 20",
    category: "movie_theater",
    streetAddress: "555 N Alafaya Trail, Orlando, FL 32828",
    latitude: 28.5590,
    longitude: -81.2095,
    estimatedDriveTimeMinutes: 15,
    studentRelevanceScore: 50,
    monitoringTier: "C",
    discoverySource: "category search: entertainment near UCF",
    website: "https://www.amctheatres.com",
    sources: [
      { key: "amc-site", sourceType: "promotions_page", sourceUrl: "https://www.amctheatres.com/programs/amc-student-discount", monitorFrequencyHours: 168, scrapingMethod: "static_fetch" },
    ],
  },

  // ── Housing (Tier A/B, spec Phase 2 "housing/apartments") ──────────
  {
    key: "station-alafaya",
    name: "The Station Alafaya",
    category: "student_housing",
    streetAddress: "12100 Solar Drive, Orlando, FL 32826",
    latitude: 28.5930,
    longitude: -81.2045,
    estimatedDriveTimeMinutes: 7,
    studentRelevanceScore: 64,
    monitoringTier: "B",
    discoverySource: "web-research: verified Landmark Properties page",
    website: "https://www.landmarkproperties.com/property/the-station-alafaya/",
    sources: [
      { key: "station-alafaya-site", sourceType: "promotions_page", sourceUrl: "https://www.landmarkproperties.com/property/the-station-alafaya/", monitorFrequencyHours: 72, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "campus-crossings-alafaya",
    name: "Campus Crossings on Alafaya",
    category: "student_housing",
    streetAddress: "4001 Cadiz Loop, Orlando, FL 32817",
    latitude: 28.5945,
    longitude: -81.2040,
    estimatedDriveTimeMinutes: 6,
    studentRelevanceScore: 63,
    monitoringTier: "B",
    discoverySource: "web-research: verified livealafaya.com page",
    website: "https://www.livealafaya.com/orlando/campus-crossings-on-alafaya/student/",
    sources: [
      { key: "campus-crossings-site", sourceType: "promotions_page", sourceUrl: "https://www.livealafaya.com/orlando/campus-crossings-on-alafaya/student/", monitorFrequencyHours: 72, scrapingMethod: "static_fetch" },
    ],
  },
  {
    key: "verve-orlando",
    name: "VERVE Orlando",
    category: "student_housing",
    streetAddress: "4100 Science Drive, Orlando, FL 32816",
    latitude: 28.5960,
    longitude: -81.2020,
    estimatedDriveTimeMinutes: 5,
    studentRelevanceScore: 66,
    monitoringTier: "A",
    discoverySource: "web-research: verified subtextliving.com page",
    website: "https://subtextliving.com/p/verve-orlando/",
    sources: [
      {
        key: "verve-site",
        sourceType: "promotions_page",
        sourceUrl: "https://subtextliving.com/p/verve-orlando/",
        monitorFrequencyHours: 72,
        scrapingMethod: "manual",
        notes: "Subtext's property pages render leasing specials client-side — flagged MANUAL_SOURCE (spec Phase 3).",
      },
    ],
  },
  {
    key: "lark-central-florida",
    name: "Lark Central Florida",
    category: "student_housing",
    streetAddress: "3200 N Alafaya Trail, Orlando, FL 32826",
    latitude: 28.5955,
    longitude: -81.2035,
    estimatedDriveTimeMinutes: 6,
    studentRelevanceScore: 61,
    monitoringTier: "B",
    discoverySource: "web-research: verified larkcentralflorida.com",
    website: "https://larkcentralflorida.com/",
    sources: [
      { key: "lark-site", sourceType: "promotions_page", sourceUrl: "https://larkcentralflorida.com/", monitorFrequencyHours: 72, scrapingMethod: "static_fetch" },
    ],
  },
];

export interface SeedPendingDeal {
  key: string;
  merchantKey: string;
  sourceKey: string;
  rawText: string;
}

/**
 * Realistic pending deal_raw_content rows so `deals:process`/`deals:demo`
 * has real signal to extract from without a live network fetch. Grounded
 * in the real discounts turned up during merchant research (student-ID
 * discounts at Freddy's/4 Rivers/Ahmed, lunch-price specials at Luya,
 * Buffalo Wild Wings weekday lunch specials) plus a few illustrative
 * fresh/recurring examples covering the spec's target content mix
 * (60-70% fresh/time-sensitive, 20-30% recurring, 10-20% evergreen).
 */
export const UCF_PENDING_DEAL_CONTENT: SeedPendingDeal[] = [
  {
    key: "freddys-student-id",
    merchantKey: "freddys",
    sourceKey: "freddys-site",
    rawText: "UCF students get 10% off their order every day with a valid student ID. Dine-in or takeout.",
  },
  {
    key: "4rivers-student-id",
    merchantKey: "4-rivers-smokehouse",
    sourceKey: "4rivers-site",
    rawText: "Show your student ID for 10% off your order at 4 Rivers Smokehouse. Valid any day, any time.",
  },
  {
    key: "bww-lunch-special",
    merchantKey: "buffalo-wild-wings",
    sourceKey: "bww-site",
    rawText: "Lunch specials under $7.99 every Monday, Tuesday, Wednesday, Thursday and Friday from 11am to 2pm.",
  },
  {
    key: "blaze-byo-pizza",
    merchantKey: "blaze-pizza",
    sourceKey: "blaze-site",
    rawText: "Build your own pizza with unlimited toppings for just $8.45, every day this month.",
  },
  {
    key: "ahmed-lunch-buffet",
    merchantKey: "ahmed-indian",
    sourceKey: "ahmed-site",
    rawText: "10% off Lunch Buffet and 15% off menu orders for all students with a valid student ID.",
  },
  {
    key: "chipotle-bogo-tuesday",
    merchantKey: "chipotle",
    sourceKey: "chipotle-site",
    rawText: "BOGO entree every Tuesday this month through the Chipotle app. Use code KNIGHTS at checkout.",
  },
  {
    key: "wingstop-wing-wednesday",
    merchantKey: "wingstop",
    sourceKey: "wingstop-site",
    rawText: "50% off wings every Wednesday, dine-in only, while supplies last.",
  },
  {
    key: "pop-parlour-bogo-boba",
    merchantKey: "pop-parlour",
    sourceKey: "pop-parlour-site",
    rawText: "Buy one boba tea, get one free every Thursday after 3pm. Show this post at checkout.",
  },
  {
    key: "kung-fu-tea-student-id",
    merchantKey: "kung-fu-tea",
    sourceKey: "kung-fu-tea-site",
    rawText: "Free size upgrade on any drink with a valid student ID, every day.",
  },
  {
    key: "cold-stone-dollar-off",
    merchantKey: "cold-stone",
    sourceKey: "cold-stone-site",
    rawText: "$1 off any Creation this month with UCF student ID.",
  },
  {
    key: "station-alafaya-move-in",
    merchantKey: "station-alafaya",
    sourceKey: "station-alafaya-site",
    rawText: "Sign a lease this month and get a $500 move-in credit. Limited availability.",
  },
  {
    key: "verve-waived-fee",
    merchantKey: "verve-orlando",
    sourceKey: "verve-site",
    rawText: "Waived application fee for new leases signed this week only.",
  },
  {
    key: "revamp-student-special",
    merchantKey: "revamp-ucf",
    sourceKey: "revamp-site",
    rawText: "Student special: $5 off any haircut with a valid UCF ID.",
  },
  {
    key: "planet-fitness-free-trial",
    merchantKey: "planet-fitness-waterford",
    sourceKey: "planet-fitness-site",
    rawText: "Free trial week for UCF students this month. Bring your student ID to redeem.",
  },
  {
    key: "gringos-locos-taco-tuesday",
    merchantKey: "gringos-locos",
    sourceKey: "gringos-site",
    rawText: "Taco Tuesday every Tuesday — tacos for $2 each, all day.",
  },
  {
    key: "jersey-mikes-sub-deal",
    merchantKey: "jersey-mikes",
    sourceKey: "jersey-mikes-site",
    rawText: "Show your student ID for a regular sub for $8 or a giant sub for $12, every day.",
  },
];
