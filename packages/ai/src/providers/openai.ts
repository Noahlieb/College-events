import OpenAI from "openai";
import {
  AppealAssessmentSchema,
  CaptionSchema,
  ClassificationSchema,
  DuplicateComparisonSchema,
  ExtractedEventSchema,
  FlyerAnalysisSchema,
  SummarySchema,
  type AppealAssessment,
  type Caption,
  type Classification,
  type DuplicateComparison,
  type ExtractedEvent,
  type FlyerAnalysis,
  type Summary,
} from "../schemas.js";
import {
  analyzeEventPrompt,
  analyzeFlyerPrompt,
  classifyEventPrompt,
  compareDuplicatesPrompt,
  generateCaptionPrompt,
  scoreEventPrompt,
  summarizeEventPrompt,
} from "../prompts.js";
import { parseAndValidate } from "../json-util.js";
import type {
  AIProvider,
  AnalyzeEventInput,
  AnalyzeFlyerInput,
  ClassifyEventInput,
  CompareDuplicatesInput,
  GenerateCaptionInput,
  ScoreEventAppealInput,
  SummarizeEventInput,
} from "../types.js";
import { AIProviderError } from "../types.js";

export interface OpenAIProviderOptions {
  apiKey: string;
  model?: string;
}

/** Real OpenAI implementation of AIProvider, using JSON-mode chat completions. */
export class OpenAIAIProvider implements AIProvider {
  readonly name = "openai";
  private client: OpenAI;
  private model: string;

  constructor(options: OpenAIProviderOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey });
    this.model = options.model ?? "gpt-5";
  }

  private async complete(system: string, user: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const text = response.choices[0]?.message?.content;
      if (!text) throw new AIProviderError("OpenAI response contained no content", this.name);
      return text;
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      throw new AIProviderError(`OpenAI API call failed: ${(err as Error).message}`, this.name, err);
    }
  }

  async analyzeEvent(input: AnalyzeEventInput): Promise<ExtractedEvent> {
    const { system, user } = analyzeEventPrompt(input);
    const raw = await this.complete(system, user);
    return parseAndValidate(this.name, raw, ExtractedEventSchema);
  }

  async analyzeFlyer(input: AnalyzeFlyerInput): Promise<FlyerAnalysis> {
    const { system, user } = analyzeFlyerPrompt(input);
    // NOTE: wire the image into a vision-capable message (image_url content
    // part) once raw_content stores fetched flyer bytes/URLs in the MVP.
    const raw = await this.complete(system, user);
    return parseAndValidate(this.name, raw, FlyerAnalysisSchema);
  }

  async classifyEvent(input: ClassifyEventInput): Promise<Classification> {
    const { system, user } = classifyEventPrompt(input);
    const raw = await this.complete(system, user);
    return parseAndValidate(this.name, raw, ClassificationSchema);
  }

  async scoreEvent(input: ScoreEventAppealInput): Promise<AppealAssessment> {
    const { system, user } = scoreEventPrompt(input);
    const raw = await this.complete(system, user);
    return parseAndValidate(this.name, raw, AppealAssessmentSchema);
  }

  async summarizeEvent(input: SummarizeEventInput): Promise<Summary> {
    const { system, user } = summarizeEventPrompt(input);
    const raw = await this.complete(system, user);
    return parseAndValidate(this.name, raw, SummarySchema);
  }

  async generateCaption(input: GenerateCaptionInput): Promise<Caption> {
    const { system, user } = generateCaptionPrompt(input);
    const raw = await this.complete(system, user);
    return parseAndValidate(this.name, raw, CaptionSchema);
  }

  async compareDuplicates(input: CompareDuplicatesInput): Promise<DuplicateComparison> {
    const { system, user } = compareDuplicatesPrompt(input);
    const raw = await this.complete(system, user);
    return parseAndValidate(this.name, raw, DuplicateComparisonSchema);
  }
}
