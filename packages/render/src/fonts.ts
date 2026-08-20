import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type GlyphPathCommand =
  | { type: "M" | "L"; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "Z" };

export interface GlyphOutline {
  advanceWidth: number;
  commands: GlyphPathCommand[];
}

export interface GlyphFont {
  unitsPerEm: number;
  glyphs: Record<string, GlyphOutline>;
}

/**
 * Fonts are shipped as pre-extracted glyph outline data (JSON, produced
 * once by scripts/extract-glyphs.mjs from the bundled .ttf files) rather
 * than parsed from the raw font files at request time. This is a
 * deliberately harder-to-explain design than "just parse the .ttf with
 * opentype.js" — that's what an earlier version of this file did, and it
 * demonstrably worked every single time it was run locally against these
 * exact fonts, yet produced garbled/box-shaped glyphs once deployed to
 * Vercel's Node.js Function runtime, with no error and no reproducible
 * local counterpart to debug against. Rather than keep chasing a bundler-
 * or-runtime-specific difference that can't be observed outside that
 * environment, the glyph shapes are extracted once (offline, where the
 * extraction is verified correct) and the runtime here does nothing more
 * than JSON.parse plus arithmetic — see textLayout.ts's textToPathData for
 * the actual scale/translate math.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const GLYPH_DATA_DIR = join(__dirname, "..", "src", "glyph-data");

function loadGlyphFont(filename: string): GlyphFont {
  const raw = readFileSync(join(GLYPH_DATA_DIR, filename), "utf-8");
  return JSON.parse(raw) as GlyphFont;
}

let displayFontCache: GlyphFont | null = null;
let bodyBoldFontCache: GlyphFont | null = null;
let bodyRegularFontCache: GlyphFont | null = null;

/** Big condensed display face used for slide titles/kickers (Anton). */
export function displayFont(): GlyphFont {
  return (displayFontCache ??= loadGlyphFont("anton.json"));
}

/** Bold body face used for dates, meta lines, category pill, wordmark (Archivo Bold). */
export function bodyBoldFont(): GlyphFont {
  return (bodyBoldFontCache ??= loadGlyphFont("archivo-bold.json"));
}

/** Regular body face used for descriptions and source attribution (Archivo Regular). */
export function bodyRegularFont(): GlyphFont {
  return (bodyRegularFontCache ??= loadGlyphFont("archivo-regular.json"));
}
