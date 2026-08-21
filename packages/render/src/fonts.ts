import { font as anton } from "./glyph-data/anton.js";
import { font as archivoBold } from "./glyph-data/archivo-bold.js";
import { font as archivoRegular } from "./glyph-data/archivo-regular.js";
import type { GlyphFont } from "./glyphTypes.js";

export type { GlyphFont, GlyphOutline, GlyphPathCommand } from "./glyphTypes.js";

/**
 * Fonts are shipped as pre-extracted glyph outline data embedded directly
 * in compiled modules (see scripts/extract-glyphs.mjs) — no font files, no
 * font-parsing library, and no filesystem reads at runtime at all. Each
 * step of that removal was forced by a real production failure in this
 * repo's history: SVG <text> elements rendered as tofu boxes on Vercel (no
 * system fonts for librsvg to resolve), runtime .ttf parsing was the next
 * casualty, and any loose data file is only as reliable as the deploy
 * pipeline that ships it. What remains is ordinary imported code plus
 * arithmetic (textLayout.ts), which deploys exactly as reliably as the
 * rest of the JavaScript.
 */

/** Big condensed display face used for slide titles/kickers (Anton). */
export function displayFont(): GlyphFont {
  return anton;
}

/** Bold body face used for dates, meta lines, category pill, wordmark (Archivo Bold). */
export function bodyBoldFont(): GlyphFont {
  return archivoBold;
}

/** Regular body face used for descriptions and source attribution (Archivo Regular). */
export function bodyRegularFont(): GlyphFont {
  return archivoRegular;
}
