import type {
  AppealAssessment,
  Caption,
  Classification,
  DuplicateComparison,
  ExtractedEvent,
  FlyerAnalysis,
  Summary,
} from "./schemas.js";

export interface SchoolContext {
  name: string;
  shortName: string;
  city: string;
  state: string;
  timezone: string;
}

export interface AnalyzeEventInput {
  schoolContext: SchoolContext;
  sourceName: string;
  sourceType: string;
  sourceUrl: string | null;
  caption: string | null;
  ocrText?: string | null;
  publishedAt: string | null;
  /** "Today" as the AI's reference point, so relative phrases ("this Friday")
   * resolve consistently regardless of wall-clock time at call time. */
  currentDate: string;
}

export interface AnalyzeFlyerInput {
  schoolContext: SchoolContext;
  imageUrl: string;
  caption?: string | null;
  currentDate: string;
}

export interface ClassifyEventInput {
  name: string;
  description: string | null;
  organization: string | null;
}

export interface ScoreEventAppealInput {
  name: string;
  description: string | null;
  category: string;
  schoolContext: SchoolContext;
}

export interface SummarizeEventInput {
  name: string;
  rawDescription: string;
  maxWords?: number;
}

export interface GenerateCaptionInput {
  postType: "monday_campus" | "midweek_activities" | "thursday_nightlife" | "custom";
  schoolName: string;
  schoolShortName: string;
  events: { name: string; venue: string | null; date: string }[];
}

export interface CompareDuplicatesInput {
  eventA: { name: string; description: string | null; venue: string | null; startAt: string };
  eventB: { name: string; description: string | null; venue: string | null; startAt: string };
}

/**
 * Provider-agnostic AI surface for the whole content pipeline (spec §6).
 * Application code must depend only on this interface — never import
 * @anthropic-ai/sdk or openai directly outside providers/*.
 */
export interface AIProvider {
  readonly name: string;
  analyzeEvent(input: AnalyzeEventInput): Promise<ExtractedEvent>;
  analyzeFlyer(input: AnalyzeFlyerInput): Promise<FlyerAnalysis>;
  classifyEvent(input: ClassifyEventInput): Promise<Classification>;
  scoreEvent(input: ScoreEventAppealInput): Promise<AppealAssessment>;
  summarizeEvent(input: SummarizeEventInput): Promise<Summary>;
  generateCaption(input: GenerateCaptionInput): Promise<Caption>;
  compareDuplicates(input: CompareDuplicatesInput): Promise<DuplicateComparison>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}
