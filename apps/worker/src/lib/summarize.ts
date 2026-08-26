import type { AIProvider } from "@college-events/ai";

const MAX_WORDS_BEFORE_SHORTENING = 30;
const TARGET_MAX_WORDS = 25;

/**
 * Best-effort AI shortening for a raw scraped/typed description that's too
 * long to read well on a slide. packages/render's fitText already clamps
 * an overlong description to fit with an ellipsis as a last resort, but
 * that's dumb word-boundary truncation — it can cut off mid-sentence and
 * lose whatever information happened to fall after the cutoff. Asking the
 * model to actually summarize keeps the info that matters instead.
 *
 * Only called when the raw text is long enough that truncation would
 * actually bite — most scraped captions are already short, so this doesn't
 * add an AI round trip to the common case. Never blocks event creation on
 * a failure: falls back to the original text untouched.
 */
export async function shortenDescriptionIfNeeded(
  aiProvider: AIProvider,
  description: string | null,
  eventName: string,
): Promise<string | null> {
  if (!description) return description;
  const wordCount = description.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount <= MAX_WORDS_BEFORE_SHORTENING) return description;
  try {
    const { summary } = await aiProvider.summarizeEvent({
      name: eventName,
      rawDescription: description,
      maxWords: TARGET_MAX_WORDS,
    });
    return summary || description;
  } catch {
    return description;
  }
}
