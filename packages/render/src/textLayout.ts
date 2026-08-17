/**
 * Deterministic, dependency-free text layout for the slide renderer. There's
 * no real font-shaping engine available in this pipeline (no headless
 * browser/canvas), so wrapping and shrink-to-fit are done with an
 * average-character-width estimate — accurate enough for a condensed
 * display font at the sizes we render, and fully unit-testable without
 * rendering an actual image.
 */

/** Average glyph width as a fraction of font size, tuned for a condensed
 * bold sans/display face (e.g. Anton, Archivo Black). */
export const AVG_CHAR_WIDTH_RATIO = 0.58;

export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * AVG_CHAR_WIDTH_RATIO;
}

export function maxCharsForWidth(widthPx: number, fontSize: number): number {
  return Math.max(1, Math.floor(widthPx / (fontSize * AVG_CHAR_WIDTH_RATIO)));
}

export function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function truncateLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1]!;
  kept[maxLines - 1] = last.replace(/\s+\S*$/, "").replace(/[.,;:]$/, "") + "…";
  return kept;
}

export interface FitResult {
  fontSize: number;
  lines: string[];
}

/**
 * Shrinks font size in steps until the wrapped text fits within maxLines at
 * the given box width, never going below minFontSize. This is the "no
 * overflowing text" guarantee from spec §18 — titles that are too long
 * shrink first, and only truncate (with an ellipsis) once they hit the
 * minimum readable size.
 */
export function fitText(
  text: string,
  opts: { boxWidth: number; startFontSize: number; minFontSize: number; maxLines: number; step?: number },
): FitResult {
  const step = opts.step ?? 4;
  let fontSize = opts.startFontSize;
  while (fontSize >= opts.minFontSize) {
    const maxChars = maxCharsForWidth(opts.boxWidth, fontSize);
    const lines = wrapText(text, maxChars);
    if (lines.length <= opts.maxLines) {
      return { fontSize, lines };
    }
    fontSize -= step;
  }
  const maxChars = maxCharsForWidth(opts.boxWidth, opts.minFontSize);
  return { fontSize: opts.minFontSize, lines: truncateLines(wrapText(text, maxChars), opts.maxLines) };
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
