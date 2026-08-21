import type { GlyphFont, GlyphPathCommand } from "./fonts.js";

/**
 * Text layout for the slide renderer, measured against real glyph metrics
 * from the bundled fonts' pre-extracted outline data (see fonts.ts) rather
 * than an estimate — accurate wrapping and shrink-to-fit, and the same
 * outlines are turned into SVG path data (textToPathData) so nothing is
 * ever rendered as an SVG `<text>` element. See fonts.ts for why: text
 * outlined this way is immune to both the "no system fonts in this
 * serverless runtime" problem and a font-parsing-library runtime
 * inconsistency between local and deployed environments — it's pure
 * arithmetic over data extracted once, offline.
 */

function glyphFor(font: GlyphFont, char: string) {
  return font.glyphs[char];
}

export function measureWidth(font: GlyphFont, text: string, fontSize: number): number {
  const scale = fontSize / font.unitsPerEm;
  let width = 0;
  for (const char of sanitizeForFont(font, text)) {
    width += (glyphFor(font, char)?.advanceWidth ?? 0) * scale;
  }
  return width;
}

/** "Smart" typography commonly seen in scraped/AI-generated copy, mapped to
 * ASCII equivalents the bundled fonts are guaranteed to have glyphs for. */
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
  " ": " ",
};

/**
 * Normalizes common "smart" typography to ASCII and drops any character not
 * present in the font's extracted glyph set (emoji, unusual symbols) —
 * better a slightly shorter string than a glyph that doesn't exist baked
 * into the image. Applied inside measureWidth and textToPathData — the two
 * primitives every layout and render call ultimately goes through — so
 * width measurements always match what's actually drawn.
 */
export function sanitizeForFont(font: GlyphFont, text: string): string {
  let out = "";
  for (const char of text) {
    const normalized = TYPOGRAPHY_NORMALIZE[char] ?? char;
    for (const c of normalized) {
      if (c === " " || c === "\n" || c === "\t" || glyphFor(font, c)) out += c;
    }
  }
  return out;
}

export function wrapText(text: string, font: GlyphFont, fontSize: number, boxWidth: number): string[] {
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
  opts: { font: GlyphFont; boxWidth: number; startFontSize: number; minFontSize: number; maxLines: number; step?: number },
): FitResult {
  const step = opts.step ?? 4;
  let fontSize = opts.startFontSize;
  while (fontSize >= opts.minFontSize) {
    const lines = wrapText(text, opts.font, fontSize, opts.boxWidth);
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
function clampLineWidth(font: GlyphFont, line: string, fontSize: number, boxWidth: number): string {
  if (measureWidth(font, line, fontSize) <= boxWidth) return line;
  let end = line.length;
  while (end > 1 && measureWidth(font, line.slice(0, end).trimEnd() + "…", fontSize) > boxWidth) {
    end--;
  }
  return line.slice(0, end).trimEnd() + "…";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Transforms one glyph's font-space outline commands into an SVG path `d`
 * fragment at the given screen position/size. Font coordinate space has Y
 * increasing upward from the baseline; SVG has Y increasing downward, so Y
 * is negated relative to the origin. */
function glyphCommandsToPathData(commands: GlyphPathCommand[], originX: number, originY: number, scale: number): string {
  const parts: string[] = [];
  for (const cmd of commands) {
    switch (cmd.type) {
      case "M":
        parts.push(`M${round2(originX + cmd.x * scale)} ${round2(originY - cmd.y * scale)}`);
        break;
      case "L":
        parts.push(`L${round2(originX + cmd.x * scale)} ${round2(originY - cmd.y * scale)}`);
        break;
      case "C":
        parts.push(
          `C${round2(originX + cmd.x1 * scale)} ${round2(originY - cmd.y1 * scale)} ${round2(originX + cmd.x2 * scale)} ${round2(originY - cmd.y2 * scale)} ${round2(originX + cmd.x * scale)} ${round2(originY - cmd.y * scale)}`,
        );
        break;
      case "Q":
        parts.push(
          `Q${round2(originX + cmd.x1 * scale)} ${round2(originY - cmd.y1 * scale)} ${round2(originX + cmd.x * scale)} ${round2(originY - cmd.y * scale)}`,
        );
        break;
      case "Z":
        parts.push("Z");
        break;
    }
  }
  return parts.join("");
}

/** Outlines one line of text to standalone SVG path `d` data at the given
 * origin/size using the font's pre-extracted glyph outlines. */
export function textToPathData(font: GlyphFont, text: string, x: number, y: number, fontSize: number): string {
  const sanitized = sanitizeForFont(font, text);
  const scale = fontSize / font.unitsPerEm;
  let cursorX = x;
  const parts: string[] = [];
  for (const char of sanitized) {
    const glyph = glyphFor(font, char);
    if (glyph) {
      const d = glyphCommandsToPathData(glyph.commands, cursorX, y, scale);
      if (d) parts.push(d);
      cursorX += glyph.advanceWidth * scale;
    }
  }
  return parts.join(" ");
}

/** Convenience wrapper: a full `<path>` element for one line of text, with
 * arbitrary extra SVG attributes (fill, opacity — letter-spacing has no
 * path equivalent, so kerning-sensitive spacing must be baked into `text`). */
export function textPathElement(
  font: GlyphFont,
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
