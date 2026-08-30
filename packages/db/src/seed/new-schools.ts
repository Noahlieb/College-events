import type { SchoolBranding, WeeklyScheduleSlot } from "@college-events/core";
import type { SeedSource } from "./data.js";

const TZ = "America/New_York";

export interface NewSchoolSeed {
  school: {
    name: string;
    shortName: string;
    city: string;
    state: string;
    latitude: number;
    longitude: number;
    timezone: string;
    active: boolean;
    branding: SchoolBranding;
    defaultRadiusMiles: number;
    weeklySchedule: WeeklyScheduleSlot[];
    instagramAccount: string | null;
  };
  sources: SeedSource[];
}

function schedule(label: string): WeeklyScheduleSlot[] {
  return [
    { postType: "monday_campus", dayOfWeek: 1, label: `This Week at ${label}`, hour: 9, minute: 0 },
    { postType: "thursday_nightlife", dayOfWeek: 4, label: "Weekend Guide", hour: 15, minute: 0 },
  ];
}

// Only the posh_vip source is real for these schools right now -- it's the one
// scraper (scrape_posh.py, driven by schools.json) actually pointed at them.
// No campus/athletics sources are seeded here since we don't have verified
// URLs for their Owl-Central-equivalent or athletics sites; add those through
// the dashboard's Sources page (see README's "Adding a new source") once
// they're identified.
function poshSource(): SeedSource[] {
  return [
    {
      key: "posh_vip",
      name: "Posh.vip Nightlife",
      sourceType: "manual_submission",
      category: "nearby",
      url: "https://posh.vip/explore",
      priority: 6,
      scrapeFrequencyMinutes: 1440,
      forceCategory: "nightlife",
    },
  ];
}

/**
 * Real schools.json coordinates for each, so the DB's location matches the
 * posh.vip /explore URL the scraper actually uses. Branding colors are each
 * school's well-known palette, approximated like FAU's -- not official
 * Pantone values -- and instagramAccount is left null rather than guessed.
 */
export const NEW_SCHOOLS: NewSchoolSeed[] = [
  {
    school: {
      name: "University of Central Florida",
      shortName: "UCF",
      city: "Orlando",
      state: "FL",
      latitude: 28.5383,
      longitude: -81.3792,
      timezone: TZ,
      active: true,
      branding: {
        primaryColor: "#000000",
        secondaryColor: "#BA9B37",
        accentColor: "#FFFFFF",
        backgroundColor: "#0B0B0F",
        fontFamily: "Anton, Helvetica, Arial, sans-serif",
      },
      defaultRadiusMiles: 50,
      weeklySchedule: schedule("UCF"),
      instagramAccount: null,
    },
    sources: poshSource(),
  },
  {
    school: {
      name: "Florida State University",
      shortName: "FSU",
      city: "Tallahassee",
      state: "FL",
      latitude: 30.4383,
      longitude: -84.2807,
      timezone: TZ,
      active: true,
      branding: {
        primaryColor: "#782F40",
        secondaryColor: "#CEB888",
        accentColor: "#FFFFFF",
        backgroundColor: "#0B0B0F",
        fontFamily: "Anton, Helvetica, Arial, sans-serif",
      },
      defaultRadiusMiles: 50,
      weeklySchedule: schedule("FSU"),
      instagramAccount: null,
    },
    sources: poshSource(),
  },
  {
    school: {
      name: "Florida International University",
      shortName: "FIU",
      city: "Miami",
      state: "FL",
      latitude: 25.7617,
      longitude: -80.1918,
      timezone: TZ,
      active: true,
      branding: {
        primaryColor: "#081E3F",
        secondaryColor: "#B6862C",
        accentColor: "#FFFFFF",
        backgroundColor: "#0B0B0F",
        fontFamily: "Anton, Helvetica, Arial, sans-serif",
      },
      defaultRadiusMiles: 50,
      weeklySchedule: schedule("FIU"),
      instagramAccount: null,
    },
    sources: poshSource(),
  },
  {
    school: {
      name: "University of Miami",
      shortName: "UM",
      city: "Coral Gables",
      state: "FL",
      latitude: 25.7215,
      longitude: -80.2684,
      timezone: TZ,
      active: true,
      branding: {
        primaryColor: "#F47321",
        secondaryColor: "#005030",
        accentColor: "#FFFFFF",
        backgroundColor: "#0B0B0F",
        fontFamily: "Anton, Helvetica, Arial, sans-serif",
      },
      defaultRadiusMiles: 50,
      weeklySchedule: schedule("UM"),
      instagramAccount: null,
    },
    sources: poshSource(),
  },
  {
    school: {
      name: "University of South Florida",
      shortName: "USF",
      city: "Tampa",
      state: "FL",
      latitude: 27.9506,
      longitude: -82.4572,
      timezone: TZ,
      active: true,
      branding: {
        primaryColor: "#006747",
        secondaryColor: "#CFC493",
        accentColor: "#FFFFFF",
        backgroundColor: "#0B0B0F",
        fontFamily: "Anton, Helvetica, Arial, sans-serif",
      },
      defaultRadiusMiles: 50,
      weeklySchedule: schedule("USF"),
      instagramAccount: null,
    },
    sources: poshSource(),
  },
];
