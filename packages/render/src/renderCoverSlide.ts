import sharp from "sharp";
import { bodyBoldFont, bodyRegularFont, displayFont, type GlyphFont } from "./fonts.js";
import { fitText, measureWidth, textPathElement } from "./textLayout.js";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type CoverSlideInput } from "./types.js";

const MARGIN = 72;

function centeredLine(font: GlyphFont, text: string, centerX: number, y: number, fontSize: number, attrs: Record<string, string | number>): string {
  const width = measureWidth(font, text, fontSize);
  return textPathElement(font, text, centerX - width / 2, y, fontSize, attrs);
}

/**
 * Renders the slide-1 cover card for a weekly carousel (e.g. "THIS WEEK AT
 * FAU — August 24-30"). No source photo involved, so this is pure branded
 * design: school colors, a bold diagonal accent, big kicker + date range.
 * Text is outlined to SVG paths via the bundled fonts (fonts.ts) rather
 * than rendered as `<text>` — see fonts.ts for why.
 */
export async function renderCoverSlide(input: CoverSlideInput): Promise<Buffer> {
  const { branding } = input;
  const display = displayFont();
  const bodyBold = bodyBoldFont();
  const bodyRegular = bodyRegularFont();
  const centerX = SLIDE_WIDTH / 2;

  // Bumped from 104/56 — a short kicker like "WEEKEND GUIDE" was already
  // hitting fitText's max and still reading small against the full
  // 1080x1350 canvas; this is the actual ceiling now, not a floor that
  // happens to be reached.
  const kicker = fitText(input.kicker.toUpperCase(), {
    font: display,
    boxWidth: SLIDE_WIDTH - MARGIN * 2,
    startFontSize: 140,
    minFontSize: 72,
    maxLines: 3,
  });
  const kickerLineH = kicker.fontSize * 1.05;
  const kickerBlockH = kicker.lines.length * kickerLineH;

  const kickerBaseY = SLIDE_HEIGHT / 2 - kickerBlockH / 2;
  const dateRangeY = SLIDE_HEIGHT / 2 + kickerBlockH / 2 + 70;
  const subtitleY = dateRangeY + 56;

  const kickerPaths = kicker.lines
    .map((line, i) => centeredLine(display, line, centerX, kickerBaseY + (i + 1) * kickerLineH, kicker.fontSize, { fill: "#FFFFFF" }))
    .join("\n");

  const dateRangePath = centeredLine(bodyBold, input.dateRange.toUpperCase(), centerX, dateRangeY, 48, {
    fill: branding.accentColor,
  });

  const subtitlePath = input.subtitle
    ? centeredLine(bodyRegular, input.subtitle, centerX, subtitleY, 30, { fill: "#FFFFFF", opacity: 0.85 })
    : "";

  const wordmarkPath = centeredLine(bodyBold, branding.wordmark, centerX, SLIDE_HEIGHT - MARGIN, 26, {
    fill: "#FFFFFF",
    opacity: 0.75,
  });

  const svg = `
    <svg width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${branding.primaryColor}" />
          <stop offset="55%" stop-color="${branding.secondaryColor}" />
          <stop offset="100%" stop-color="${branding.backgroundColor}" />
        </linearGradient>
      </defs>
      <rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="url(#bg)" />
      <polygon points="0,0 ${SLIDE_WIDTH},0 ${SLIDE_WIDTH},260 0,520" fill="${branding.backgroundColor}" opacity="0.18" />
      <polygon points="0,${SLIDE_HEIGHT} ${SLIDE_WIDTH},${SLIDE_HEIGHT} ${SLIDE_WIDTH},${SLIDE_HEIGHT - 260} 0,${SLIDE_HEIGHT - 520}" fill="#000000" opacity="0.18" />
      ${kickerPaths}
      ${dateRangePath}
      ${subtitlePath}
      ${wordmarkPath}
    </svg>
  `;

  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}
