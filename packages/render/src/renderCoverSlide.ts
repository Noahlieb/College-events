import sharp from "sharp";
import { escapeXml, fitText } from "./textLayout.js";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type CoverSlideInput } from "./types.js";

const MARGIN = 72;

/**
 * Renders the slide-1 cover card for a weekly carousel (e.g. "THIS WEEK AT
 * FAU — August 24-30"). No source photo involved, so this is pure branded
 * design: school colors, a bold diagonal accent, big kicker + date range.
 */
export async function renderCoverSlide(input: CoverSlideInput): Promise<Buffer> {
  const { branding } = input;
  const fontFamily = branding.fontFamily ?? "Arial Black, Helvetica, Arial, sans-serif";

  const kicker = fitText(input.kicker.toUpperCase(), {
    boxWidth: SLIDE_WIDTH - MARGIN * 2,
    startFontSize: 104,
    minFontSize: 56,
    maxLines: 3,
  });
  const kickerLineH = kicker.fontSize * 1.05;
  const kickerBlockH = kicker.lines.length * kickerLineH;

  const dateRangeY = SLIDE_HEIGHT / 2 + kickerBlockH / 2 + 70;
  const subtitleY = dateRangeY + 56;

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

      <text x="${SLIDE_WIDTH / 2}" text-anchor="middle" font-family="${fontFamily}" font-size="${kicker.fontSize}" font-weight="900" fill="#FFFFFF">
        ${kicker.lines
          .map(
            (line, i) =>
              `<tspan x="${SLIDE_WIDTH / 2}" y="${SLIDE_HEIGHT / 2 - kickerBlockH / 2 + (i + 1) * kickerLineH}">${escapeXml(line)}</tspan>`,
          )
          .join("")}
      </text>

      <text x="${SLIDE_WIDTH / 2}" y="${dateRangeY}" text-anchor="middle" font-family="${fontFamily}" font-size="40" font-weight="700" fill="${branding.accentColor}" letter-spacing="3">${escapeXml(input.dateRange.toUpperCase())}</text>

      ${
        input.subtitle
          ? `<text x="${SLIDE_WIDTH / 2}" y="${subtitleY}" text-anchor="middle" font-family="${fontFamily}" font-size="26" font-weight="400" fill="#FFFFFF" opacity="0.85">${escapeXml(input.subtitle)}</text>`
          : ""
      }

      <text x="${SLIDE_WIDTH / 2}" y="${SLIDE_HEIGHT - MARGIN}" text-anchor="middle" font-family="${fontFamily}" font-size="24" font-weight="700" fill="#FFFFFF" opacity="0.75" letter-spacing="2">${escapeXml(branding.wordmark)}</text>
    </svg>
  `;

  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}
