import type { Font } from "opentype.js";

/**
 * Text layout for the slide renderer, measured against the real bundled
 * font's glyph metrics (via opentype.js) rather than an estimate — accurate
 * wrapping and shrink-to-fit, and the same measurements are reused to
 * outline each line to SVG path data (textToPathData) so nothing is ever
 * rendered as an SVG `<text>` element. See fonts.ts for why: serverless
 * environments like Vercel's Node.js functions have no system fonts for
 * librsvg/pango to resolve `font-family` against, which silently produces
 * missing or garbled glyphs there even though it looks correct locally.
 */

/** "Smart" typography commonly seen in scraped/AI-generated copy, mapped to
 * ASCII equivalents our bundled fonts are guaranteed to have glyphs for. */
const TYPOGRAPHY_NORMALIZE: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
  "→": "->",
  "←": "<-",
  " ": " ",
};

const missingGlyphCache = new WeakMap<Font, Map<string, boolean>>();

function fontHasGlyph(font: Font, char: string): boolean {
  let cache = missingGlyphCache.get(font);
  if (!cache) {
    cache = new Map();
    missingGlyphCache.set(font, cache);
  }
  let has = cache.get(char);
  if (has === undefined) {
    has = font.charToGlyphIndex(char) !== 0; // glyph index 0 is always .notdef
    cache.set(char, has);
  }
  return has;
}

/**
 * Normalizes common "smart" typography to ASCII and drops any character the
 * font has no glyph for (emoji, unusual symbols). Applied inside
 * measureWidth and textToPathData — the two primitives every layout and
 * render call ultimately goes through — so a scraped title or AI-written
 * description can never bake a visible `.notdef` box into the image, and
 * width measurements always match what's actually drawn.
 */
export function sanitizeForFont(font: Font, text: string): string {
  let out = "";
  for (const char of text) {
    const normalized = TYPOGRAPHY_NORMALIZE[char] ?? char;
    for (const c of normalized) {
      if (c === " " || c === "\n" || c === "\t" || fontHasGlyph(font, c)) out += c;
    }
  }
  return out;
}

export function measureWidth(font: Font, text: string, fontSize: number): number {
  return font.getAdvanceWidth(sanitizeForFont(font, text), fontSize);
}

export function wrapText(text: string, font: Font, fontSize: number, boxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measureWidth(font, candidate, fontSize) > boxWidth) {
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
  opts: { font: Font; boxWidth: number; startFontSize: number; minFontSize: number; maxLines: number; step?: number },
): FitResult {
  const step = opts.step ?? 4;
  let fontSize = opts.startFontSize;
  while (fontSize >= opts.minFontSize) {
    const lines = wrapText(text, opts.font, fontSize, opts.boxWidth);
    // Line count alone isn't enough: a single word (a URL slug, a long
    // hyphenated name — no spaces for wrapText to break on) can produce
    // few "lines" that are each still wider than the box, and would
    // otherwise render past the edge of the canvas at the start font size.
    if (lines.length <= opts.maxLines && lines.every((line) => measureWidth(opts.font, line, fontSize) <= opts.boxWidth)) {
      return { fontSize, lines };
    }
    fontSize -= step;
  }
  const lines = truncateLines(wrapText(text, opts.font, opts.minFontSize, opts.boxWidth), opts.maxLines).map((line) =>
    clampLineWidth(opts.font, line, opts.minFontSize, opts.boxWidth),
  );
  return { fontSize: opts.minFontSize, lines };
}

/** Last-resort safety net for a single line that's still too wide for the
 * box even at minFontSize (an unbroken word longer than the whole line
 * budget) — trims characters until it fits, then adds an ellipsis. */
function clampLineWidth(font: Font, line: string, fontSize: number, boxWidth: number): string {
  if (measureWidth(font, line, fontSize) <= boxWidth) return line;
  let end = line.length;
  while (end > 1 && measureWidth(font, line.slice(0, end).trimEnd() + "…", fontSize) > boxWidth) {
    end--;
  }
  return line.slice(0, end).trimEnd() + "…";
}

/**
 * Outlines one line of text to standalone SVG path `d` data at the given
 * origin/size using the font's real glyph outlines.
 *
 * Deliberately walks glyphs one at a time and accumulates the x cursor
 * itself, instead of the one-line `font.getPath(text, x, y, fontSize)` —
 * opentype.js 2.0.0 (the current latest) has a reproducible bug where that
 * whole-string path returns literal "NaN" coordinates for specific glyphs
 * once the running x position lands on certain floating-point values deep
 * enough into a string (e.g. "ANTHONY+GREEN" broke on the second "E", 13
 * characters in, in exactly one font). It doesn't reproduce through a
 * single glyph's own getPath, and rounding the accumulated x before each
 * per-glyph call reliably avoids it — so kerning is sacrificed (a minor
 * cosmetic loss on a bold display face) for text that never silently
 * renders as a broken shape.
 */
/** Nudges applied (in order) when a glyph's path comes back with NaN
 * coordinates — rounding the x cursor avoids most occurrences of the
 * opentype.js bug described above, but not all of them; a handful of exact
 * values are still unlucky even after rounding. Each nudge is small enough
 * to be visually imperceptible (well under a pixel at any slide font
 * size) while reliably landing off whatever exact value triggers it. */
const NAN_RECOVERY_NUDGES = [0.1, 0.37, -0.23, 0.5, -0.5, 1];

function glyphPathDataSafe(glyph: ReturnType<Font["glyphs"]["get"]>, x: number, y: number, fontSize: number): string {
  let d = glyph.getPath(x, y, fontSize).toPathData(2);
  if (!d.includes("NaN")) return d;
  for (const nudge of NAN_RECOVERY_NUDGES) {
    d = glyph.getPath(x + nudge, y, fontSize).toPathData(2);
    if (!d.includes("NaN")) return d;
  }
  // Every nudge still produced NaN — drop this one glyph's path rather than
  // ever emit a corrupted shape into the final image.
  return "";
}

export function textToPathData(font: Font, text: string, x: number, y: number, fontSize: number): string {
  const sanitized = sanitizeForFont(font, text);
  const scale = fontSize / font.unitsPerEm;
  let cursorX = x;
  const parts: string[] = [];
  for (const glyph of font.stringToGlyphs(sanitized)) {
    const roundedX = Math.round(cursorX * 100) / 100;
    const d = glyphPathDataSafe(glyph, roundedX, y, fontSize);
    if (d) parts.push(d);
    cursorX += (glyph.advanceWidth ?? 0) * scale;
  }
  return parts.join(" ");
}

/** Convenience wrapper: a full `<path>` element for one line of text, with
 * arbitrary extra SVG attributes (fill, opacity, letter-spacing has no
 * path equivalent so kerning-sensitive spacing must be baked into `text`). */
export function textPathElement(
  font: Font,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  attrs: Record<string, string | number>,
): string {
  const d = textToPathData(font, text, x, y, fontSize);
  const attrString = Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");
  return `<path d="${d}" ${attrString} />`;
}
