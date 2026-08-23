export interface SlideBranding {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  fontFamily?: string | null;
  wordmark: string; // e.g. "@faucampusscene"
}

export interface EventSlideInput {
  /** Pre-fetched source photo bytes, or null to fall back to a generated
   * category-colored placeholder background (spec §18 "no image" case). */
  image: Buffer | null;
  date: string; // pre-formatted, e.g. "AUGUST 22ND"
  title: string;
  venue: string | null;
  time: string | null; // pre-formatted, e.g. "5PM–8:30PM"
  price: string | null;
  description: string | null;
  category: string;
  branding: SlideBranding;
}

export interface CoverSlideInput {
  kicker: string; // e.g. "THIS WEEK AT FAU"
  dateRange: string; // e.g. "AUGUST 24–30"
  subtitle?: string | null;
  branding: SlideBranding;
}

export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;
