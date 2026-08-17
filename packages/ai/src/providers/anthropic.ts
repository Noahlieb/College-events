import Anthropic from "@anthropic-ai/sdk";
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

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
}

/**
 * Real Anthropic (Claude) implementation of AIProvider. Application code
 * never imports this directly — go through createAIProvider() so providers
 * stay swappable per spec §6.
 */
export class AnthropicAIProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model ?? "claude-sonnet-5";
  }

  private async complete(system: string, user: string): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: user }],
      });
      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new AIProviderError("Anthropic response contained no text block", this.name);
      }
      return textBlock.text;
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      throw new AIProviderError(`Anthropic API call failed: ${(err as Error).message}`, this.name, err);
    }
  }

  async analyzeEvent(input: AnalyzeEventInput): Promise<ExtractedEvent> {
    const { system, user } = analyzeEventPrompt(input);
    const raw = await this.complete(system, user);
    return parseAndValidate(this.name, raw, ExtractedEventSchema);
  }

  async analyzeFlyer(input: AnalyzeFlyerInput): Promise<FlyerAnalysis> {
    const { system, user } = analyzeFlyerPrompt(input);
    // NOTE: production implementation should attach the image as a vision
    // content block (base64 or URL source) per Anthropic's multimodal
    // messages API; omitted here since flyer bytes aren't fetched in the
    // MVP ingestion path yet. Wire in when raw_content stores local images.
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
