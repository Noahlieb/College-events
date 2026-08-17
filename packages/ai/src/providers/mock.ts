import { categorizeEvent } from "@college-events/core";
import type {
  AnalyzeEventInput,
  AnalyzeFlyerInput,
  AIProvider,
  ClassifyEventInput,
  CompareDuplicatesInput,
  GenerateCaptionInput,
  ScoreEventAppealInput,
  SummarizeEventInput,
} from "../types.js";
import type {
  AppealAssessment,
  Caption,
  Classification,
  DuplicateComparison,
  ExtractedEvent,
  FlyerAnalysis,
  Summary,
} from "../schemas.js";
import { titleSimilarity } from "@college-events/core";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function extractDate(text: string, referenceYear: number): string | null {
  const slash = /\b(\d{1,2})\/(\d{1,2})\b/.exec(text);
  if (slash) {
    const month = parseInt(slash[1]!, 10);
    const day = parseInt(slash[2]!, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${referenceYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const named = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(
    text,
  );
  if (named) {
    const month = MONTHS[named[1]!.toLowerCase()];
    const day = parseInt(named[2]!, 10);
    if (month && day >= 1 && day <= 31) {
      return `${referenceYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
}

function to24h(hour: number, minute: number, meridiem: string | undefined): string {
  let h = hour % 12;
  if (meridiem?.toLowerCase() === "pm") h += 12;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function extractTimes(text: string): { start: string | null; end: string | null } {
  // Flyer shorthand like "6:00-7:00pm" shares one trailing meridiem across
  // both ends of the range — handle that before falling back to per-match
  // parsing (which requires an explicit am/pm on each number).
  const sharedRange =
    /\b(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (sharedRange) {
    const [, h1, m1, h2, m2, mer] = sharedRange;
    return {
      start: to24h(parseInt(h1!, 10), m1 ? parseInt(m1, 10) : 0, mer),
      end: to24h(parseInt(h2!, 10), m2 ? parseInt(m2, 10) : 0, mer),
    };
  }

  const re = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi;
  const matches: { hour: number; minute: number; meridiem?: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[3]) continue; // require am/pm to avoid matching plain numbers (dates, prices, ages)
    matches.push({ hour: parseInt(m[1]!, 10), minute: m[2] ? parseInt(m[2], 10) : 0, meridiem: m[3] });
  }
  if (matches.length === 0) return { start: null, end: null };
  const start = to24h(matches[0]!.hour, matches[0]!.minute, matches[0]!.meridiem);
  const end = matches.length > 1 ? to24h(matches[1]!.hour, matches[1]!.minute, matches[1]!.meridiem) : null;
  return { start, end };
}

function extractPrice(text: string): string | null {
  const freeBefore = /free before \d{1,2}(:\d{2})?\s*(am|pm)?/i.exec(text);
  if (freeBefore) return freeBefore[0];
  if (/\bfree\b/i.test(text)) return "Free";
  const dollar = /\$\d+(\.\d{2})?/.exec(text);
  if (dollar) return dollar[0];
  return null;
}

function extractVenue(text: string): string | null {
  const at = /\bat ([A-Z][A-Za-z0-9&'.\s]{2,45}?)(?=[.,!]|\s+(?:on|this|doors|free|starting|from)\b|\s+\d|$)/i.exec(
    text,
  );
  if (at) return at[1]!.trim();
  return null;
}

function extractAge(text: string): string | null {
  return /21\+/.test(text) ? "21+" : null;
}

function looksLikeAnEvent(text: string, hasDate: boolean, hasTime: boolean): boolean {
  if (hasDate || hasTime) return true;
  return false;
}

/**
 * Deterministic, credential-free stand-in for a real LLM. Uses light regex
 * heuristics so the full discovery→extraction pipeline runs end-to-end with
 * zero API keys (spec §47/§5). It never invents an event when no date/time
 * signal exists — see the "generic promo post" seed fixture, which this
 * provider correctly rejects with is_event: false.
 */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async analyzeEvent(input: AnalyzeEventInput): Promise<ExtractedEvent> {
    const text = input.caption ?? input.ocrText ?? "";
    const referenceYear = new Date(input.currentDate).getUTCFullYear();
    const date = extractDate(text, referenceYear);
    const { start, end } = extractTimes(text);
    const isEvent = looksLikeAnEvent(text, !!date, !!start);

    if (!isEvent) {
      return {
        is_event: false,
        event_name: null,
        date: null,
        start_time: null,
        end_time: null,
        venue: null,
        city: null,
        price: null,
        age_requirement: null,
        category: null,
        organization: null,
        description: null,
        confidence: 0.2,
      };
    }

    const nameSource = text.split(/[—\-.!]/)[0]?.trim() || text.slice(0, 60).trim();
    const { category } = categorizeEvent({ name: nameSource, description: text });

    return {
      is_event: true,
      event_name: nameSource || null,
      date,
      start_time: start,
      end_time: end,
      venue: extractVenue(text),
      city: null,
      price: extractPrice(text),
      age_requirement: extractAge(text),
      category,
      organization: input.sourceName,
      description: text.length > 20 ? text : null,
      confidence: date && start ? 0.85 : date ? 0.65 : 0.5,
    };
  }

  async analyzeFlyer(input: AnalyzeFlyerInput): Promise<FlyerAnalysis> {
    const extracted = await this.analyzeEvent({
      schoolContext: input.schoolContext,
      sourceName: "flyer",
      sourceType: "image",
      sourceUrl: input.imageUrl,
      caption: input.caption ?? null,
      publishedAt: null,
      currentDate: input.currentDate,
    });
    return {
      has_readable_text: !!input.caption,
      ocr_text: input.caption ?? null,
      image_quality_score: 0.7,
      extracted,
    };
  }

  async classifyEvent(input: ClassifyEventInput): Promise<Classification> {
    const { category, tags } = categorizeEvent(input);
    return { category, tags: tags.length ? tags : [category], confidence: 0.75 };
  }

  async scoreEvent(input: ScoreEventAppealInput): Promise<AppealAssessment> {
    const baseline: Record<string, number> = {
      nightlife: 85, concert: 88, sports: 80, festival: 78, party: 74,
      food_drink: 68, campus: 60, student_org: 55, comedy: 68, fitness: 55,
      career: 45, academic: 35, networking: 40, community: 45, dating: 40, other: 40,
    };
    const score = baseline[input.category] ?? 50;
    return {
      appeal_score: score,
      reasoning: `Mock heuristic baseline appeal for category "${input.category}".`,
    };
  }

  async summarizeEvent(input: SummarizeEventInput): Promise<Summary> {
    const words = input.rawDescription.split(/\s+/).filter(Boolean);
    const maxWords = input.maxWords ?? 25;
    const summary = words.slice(0, maxWords).join(" ") + (words.length > maxWords ? "…" : "");
    return { summary: summary || input.name };
  }

  async generateCaption(input: GenerateCaptionInput): Promise<Caption> {
    const titles: Record<GenerateCaptionInput["postType"], string> = {
      monday_campus: `THIS WEEK AT ${input.schoolShortName} 🦉`,
      midweek_activities: `THINGS TO DO THIS WEEK 🎟️`,
      thursday_nightlife: `${input.schoolShortName} WEEKEND GUIDE 🌙`,
      custom: input.schoolName,
    };
    const intro = titles[input.postType];
    const body =
      input.postType === "thursday_nightlife"
        ? "Your weekend starts here. Save this post so you don't miss anything — swipe for the full lineup."
        : "Here are some of the best things happening this week. Save this post and tag a friend who's coming with you.";
    const caption = `${intro}\n\n${body}`;
    return { caption, hashtags: [] };
  }

  async compareDuplicates(input: CompareDuplicatesInput): Promise<DuplicateComparison> {
    const sim = titleSimilarity(input.eventA.name, input.eventB.name);
    const sameDay =
      new Date(input.eventA.startAt).toDateString() === new Date(input.eventB.startAt).toDateString();
    const isDuplicate = sim >= 0.7 && sameDay;
    return {
      is_duplicate: isDuplicate,
      confidence: sim,
      reasoning: `Title similarity ${sim.toFixed(2)}, same day: ${sameDay}.`,
    };
  }
}
