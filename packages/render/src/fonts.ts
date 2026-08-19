import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// opentype.js is CommonJS (module.exports = { Font, parse, load, ... }).
// `import * as ns` only synthesizes named bindings that cjs-module-lexer can
// statically detect, which is unreliable for this object-literal export
// shape — under Node's real ESM/CJS interop, a *default* import always
// resolves to the whole module.exports object, so `opentype.parse` is only
// guaranteed to exist through the default import, not a namespace import.
import opentype from "opentype.js";
import type { Font } from "opentype.js";

/**
 * Fonts are shipped as bundled .ttf files and pre-outlined to SVG path data
 * (see textToPathData in textLayout.ts) rather than referenced by
 * font-family name. Serverless environments like Vercel's Node.js
 * functions have no system fonts and no fontconfig setup, so any
 * `<text font-family="...">` element in an SVG composited by sharp/librsvg
 * silently renders as missing or garbled glyphs there even though it looks
 * fine locally — outlining to vector paths at render time sidesteps font
 * discovery entirely.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, "..", "assets");

function loadFont(filename: string): Font {
  const buffer = readFileSync(join(ASSETS_DIR, filename));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  return opentype.parse(arrayBuffer);
}

let displayFontCache: Font | null = null;
let bodyBoldFontCache: Font | null = null;
let bodyRegularFontCache: Font | null = null;

/** Big condensed display face used for slide titles/kickers (Anton). */
export function displayFont(): Font {
  return (displayFontCache ??= loadFont("Anton-Regular.ttf"));
}

/** Bold body face used for dates, meta lines, category pill, wordmark (Archivo Bold). */
export function bodyBoldFont(): Font {
  return (bodyBoldFontCache ??= loadFont("Archivo-Bold.ttf"));
}

/** Regular body face used for descriptions and source attribution (Archivo Regular). */
export function bodyRegularFont(): Font {
  return (bodyRegularFontCache ??= loadFont("Archivo-Regular.ttf"));
}
