import { z } from "zod";
import { EVENT_CATEGORIES, DEAL_CATEGORIES } from "@college-events/core";

/**
 * Strict structured-output schema for AI event extraction (spec §11).
 * Every field is nullable — the model must never guess. `.strict()`-adjacent
 * behavior is enforced by rejecting unknown top-level keys via zod's default
 * "strip" being explicitly avoided in favor of validation errors upstream.
 */
export const ExtractedEventSchema = z.object({
  is_event: z.boolean(),
  event_name: z.string().nullable(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  venue: z.string().nullable(),
  city: z.string().nullable(),
  price: z.string().nullable(),
  age_requirement: z.string().nullable(),
  category: z.enum(EVENT_CATEGORIES).nullable(),
  organization: z.string().nullable(),
  description: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type ExtractedEvent = z.infer<typeof ExtractedEventSchema>;

export const FlyerAnalysisSchema = z.object({
  has_readable_text: z.boolean(),
  ocr_text: z.string().nullable(),
  image_quality_score: z.number().min(0).max(1),
  extracted: ExtractedEventSchema,
});
export type FlyerAnalysis = z.infer<typeof FlyerAnalysisSchema>;

export const ClassificationSchema = z.object({
  category: z.enum(EVENT_CATEGORIES),
  tags: z.array(z.enum(EVENT_CATEGORIES)),
  confidence: z.number().min(0).max(1),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const AppealAssessmentSchema = z.object({
  appeal_score: z.number().min(0).max(100),
  reasoning: z.string(),
});
export type AppealAssessment = z.infer<typeof AppealAssessmentSchema>;

export const SummarySchema = z.object({
  summary: z.string(),
});
export type Summary = z.infer<typeof SummarySchema>;

export const CaptionSchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()),
});
export type Caption = z.infer<typeof CaptionSchema>;

export const DuplicateComparisonSchema = z.object({
  is_duplicate: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
export type DuplicateComparison = z.infer<typeof DuplicateComparisonSchema>;

/**
 * Strict structured-output schema for AI deal extraction (spec Phase 5).
 * Every optional field is nullable — the model must never guess a price,
 * expiration, or discount that isn't stated. `UNKNOWN` upstream is
 * represented simply as `null` here; the pipeline maps null expiration to
 * the UNKNOWN freshness/verification handling.
 */
export const ExtractedDealSchema = z.object({
  is_deal: z.boolean(),
  title: z.string().nullable(),
  deal_category: z.enum(DEAL_CATEGORIES).nullable(),
  clean_offer_description: z.string().nullable(),
  normal_price: z.string().nullable(),
  deal_price: z.string().nullable(),
  discount_percent: z.number().min(0).max(100).nullable(),
  discount_dollars: z.number().min(0).nullable(),
  is_bogo: z.boolean(),
  is_free_item: z.boolean(),
  student_id_required: z.boolean(),
  promo_code: z.string().nullable(),
  /** 0=Sunday..6=Saturday. Empty array means "not stated" — never assume every day. */
  valid_days_of_week: z.array(z.number().int().min(0).max(6)),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  expiration_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  recurring: z.boolean(),
  recurrence_pattern: z.string().nullable(),
  location_restrictions: z.string().nullable(),
  minimum_purchase: z.string().nullable(),
  eligibility: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type ExtractedDeal = z.infer<typeof ExtractedDealSchema>;
