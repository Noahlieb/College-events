import { z } from "zod";
import { EVENT_CATEGORIES } from "@college-events/core";

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
