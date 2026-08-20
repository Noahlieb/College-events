// Build-time only (never runs in production/deployed code). Extracts every
// printable-ASCII glyph's raw outline (in font units, unscaled/unpositioned
// — the same shape data verified correct by direct inspection) from each
// bundled font and writes it to a plain JSON lookup table. The runtime
// (fonts.ts / textLayout.ts) reads these tables and does its own simple
// scale+translate arithmetic instead of calling into opentype.js at all —
// see fonts.ts for why: opentype.js's own runtime glyph decoding produced
// tofu-box output once deployed, despite identical input working correctly
// every time it was run locally, in this exact repo, against these exact
// font files. Re-run this script (`node scripts/extract-glyphs.mjs`) only
// if the bundled .ttf files themselves change.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, "..", "assets");
const OUT_DIR = join(__dirname, "..", "src", "glyph-data");

const FONTS = [
  { file: "Anton-Regular.ttf", out: "anton.json" },
  { file: "Archivo-Bold.ttf", out: "archivo-bold.json" },
  { file: "Archivo-Regular.ttf", out: "archivo-regular.json" },
];

// Printable ASCII, space through tilde.
const CHARS = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i));

for (const { file, out } of FONTS) {
  const buffer = readFileSync(join(ASSETS_DIR, file));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const font = opentype.parse(arrayBuffer);

  const glyphs = {};
  for (const char of CHARS) {
    const glyph = font.charToGlyph(char);
    glyphs[char] = {
      advanceWidth: glyph.advanceWidth ?? 0,
      commands: glyph.path.commands,
    };
  }

  const data = { unitsPerEm: font.unitsPerEm, glyphs };
  writeFileSync(join(OUT_DIR, out), JSON.stringify(data));
  console.log(`Wrote ${out}: ${Object.keys(glyphs).length} glyphs, unitsPerEm=${font.unitsPerEm}`);
}
