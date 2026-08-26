import type { AIProvider } from "@college-events/ai";

const MAX_WORDS_BEFORE_SHORTENING = 30;
/** Character length above which a description reliably overflows the
 * slide's fixed 2-line box, regardless of word count. Word count alone
 * missed real cases: a handful of long words, or one long run of
 * decorative dashes counted as a single "word," can blow past two lines
 * of ~950px-wide text while still reading as short by word count. */
const MAX_CHARS_BEFORE_SHORTENING = 130;
const TARGET_MAX_WORDS = 25;

/**
 * Scraped Instagram captions often pad logistics/hashtags apart with a
 * long run of dashes/underscores/etc. as a visual divider, and wrap a
 * clause in underscores or asterisks for italics that never renders as
 * markdown here. Both are pure noise: they add no information, but a
 * divider run especially can be wide enough on its own to push real
 * content off a 2-line slide even when the description is short by word
 * count. Stripped unconditionally, whether or not AI shortening ends up
 * running — "@some_venue"-style underscores inside a word are left alone
 * since they're only stripped when adjacent to whitespace/the boundary.
 */
function stripDecorativeNoise(text: string): string {
  return text
    .replace(/[-_=~*]{3,}/g, " ") // divider runs
    .replace(/(^|\s)[_*]+(?=\S)/g, "$1") // leading italics marker on a word
    .replace(/(?<=\S)[_*]+(\s|$)/g, "$1") // trailing italics marker on a word
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Best-effort AI shortening for a raw scraped/typed description that's too
 * long to read well on a slide. packages/render's fitText already clamps
 * an overlong description to fit with an ellipsis as a last resort, but
 * that's dumb word-boundary truncation — it can cut off mid-sentence and
 * lose whatever information happened to fall after the cutoff. Asking the
 * model to actually summarize keeps the info that matters instead.
 *
 * Only calls the model when the cleaned text is still long enough that
 * truncation would actually bite — most scraped captions are already
 * short, so this doesn't add an AI round trip to the common case. Never
 * blocks event creation on a failure: falls back to the cleaned (but not
 * AI-shortened) text.
 */
export async function shortenDescriptionIfNeeded(
  aiProvider: AIProvider,
  description: string | null,
  eventName: string,
): Promise<string | null> {
  if (!description) return description;
  const cleaned = stripDecorativeNoise(description);
  if (!cleaned) return cleaned;

  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  const needsShortening = wordCount > MAX_WORDS_BEFORE_SHORTENING || cleaned.length > MAX_CHARS_BEFORE_SHORTENING;
  if (!needsShortening) return cleaned;

  try {
    const { summary } = await aiProvider.summarizeEvent({
      name: eventName,
      rawDescription: cleaned,
      maxWords: TARGET_MAX_WORDS,
    });
    return summary || cleaned;
  } catch {
    return cleaned;
  }
}
