import type { ZodSchema } from "zod";
import { AIProviderError } from "./types.js";

/** Models occasionally wrap JSON in ```json fences despite instructions — strip defensively. */
export function extractJsonText(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  return (fenced ? fenced[1] : raw)!.trim();
}

export function parseAndValidate<T>(providerName: string, raw: string, schema: ZodSchema<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(raw));
  } catch (err) {
    throw new AIProviderError(`${providerName} returned non-JSON output: ${raw.slice(0, 200)}`, providerName, err);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AIProviderError(
      `${providerName} output failed schema validation: ${result.error.message}`,
      providerName,
      result.error,
    );
  }
  return result.data;
}
