import { escapeXml, fitText } from "./textLayout.js";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type EventSlideInput } from "./types.js";

const MARGIN = 64;
const CONTENT_WIDTH = SLIDE_WIDTH - MARGIN * 2;

function tspanLines(lines: string[], x: number, startY: number, lineHeight: number, extraAttrs = ""): string {
  return lines
    .map((line, i) => `<tspan x="${x}" y="${startY + i * lineHeight}" ${extraAttrs}>${escapeXml(line)}</tspan>`)
    .join("");
}

/**
 * Builds the branded text/gradient overlay for one event slide as a
 * self-contained SVG string, composited on top of the (photo or placeholder)
 * background by renderSlide.ts. Bottom-anchored stacked layout, in the
 * spirit of the reference style described in spec §18/§53: hero image
 * intact, dark gradient rising from the bottom, condensed title, then
 * date/venue/time/price/description/source in descending emphasis.
 */
export function buildEventSlideOverlaySvg(input: EventSlideInput): string {
  const { branding } = input;
  const fontFamily = branding.fontFamily ?? "Arial Black, Helvetica, Arial, sans-serif";

  const title = fitText(input.title.toUpperCase(), {
    boxWidth: CONTENT_WIDTH,
    startFontSize: 88,
    minFontSize: 48,
    maxLines: 3,
  });

  const metaParts = [input.venue, input.time, input.price].filter(Boolean) as string[];
  const meta = metaParts.length
    ? fitText(metaParts.join("   •   "), { boxWidth: CONTENT_WIDTH, startFontSize: 34, minFontSize: 24, maxLines: 2 })
    : null;

  const description = input.description
    ? fitText(input.description, { boxWidth: CONTENT_WIDTH, startFontSize: 30, minFontSize: 24, maxLines: 2 })
    : null;

  const attributionText = input.source ? `Source: ${input.source}` : null;

  // ── compute stacked block heights (top to bottom) ──
  const dateH = input.date ? 34 * 1.3 : 0;
  const gap1 = input.date ? 14 : 0;
  const titleLineH = title.fontSize * 1.08;
  const titleH = title.lines.length * titleLineH;
  const gap2 = 22;
  const metaLineH = (meta?.fontSize ?? 0) * 1.35;
  const metaH = meta ? meta.lines.length * metaLineH : 0;
  const gap3 = meta ? 16 : 0;
  const descLineH = (description?.fontSize ?? 0) * 1.4;
  const descH = description ? description.lines.length * descLineH : 0;
  const gap4 = description ? 20 : 0;
  const attrH = attributionText ? 22 * 1.4 : 0;
  const gap5 = attributionText ? 16 : 0;

  const totalContentH = dateH + gap1 + titleH + gap2 + metaH + gap3 + descH + gap4 + attrH + gap5;
  const gradientStartFrac = Math.min(0.72, Math.max(0.32, 1 - (totalContentH + MARGIN * 1.6) / SLIDE_HEIGHT));

  let cursorY = SLIDE_HEIGHT - MARGIN - totalContentH;

  const parts: string[] = [];

  if (input.date) {
    cursorY += dateH * 0.75; // move to baseline for this block
    parts.push(
      `<text x="${MARGIN}" y="${cursorY}" font-family="${fontFamily}" font-size="34" font-weight="700" fill="${branding.accentColor}" letter-spacing="2">${escapeXml(input.date.toUpperCase())}</text>`,
    );
    cursorY += dateH * 0.25 + gap1;
  }

  cursorY += title.fontSize * 0.88;
  parts.push(
    `<text x="${MARGIN}" font-family="${fontFamily}" font-size="${title.fontSize}" font-weight="900" fill="#FFFFFF">${tspanLines(title.lines, MARGIN, cursorY, titleLineH)}</text>`,
  );
  cursorY += titleLineH * (title.lines.length - 1) + titleLineH * 0.3 + gap2;

  if (meta) {
    cursorY += meta.fontSize * 0.85;
    parts.push(
      `<text x="${MARGIN}" font-family="${fontFamily}" font-size="${meta.fontSize}" font-weight="700" fill="#FFFFFF" opacity="0.95">${tspanLines(meta.lines, MARGIN, cursorY, metaLineH)}</text>`,
    );
    cursorY += metaLineH * (meta.lines.length - 1) + metaLineH * 0.3 + gap3;
  }

  if (description) {
    cursorY += description.fontSize * 0.85;
    parts.push(
      `<text x="${MARGIN}" font-family="${fontFamily}" font-size="${description.fontSize}" font-weight="400" fill="#FFFFFF" opacity="0.85">${tspanLines(description.lines, MARGIN, cursorY, descLineH)}</text>`,
    );
    cursorY += descLineH * (description.lines.length - 1) + descLineH * 0.3 + gap4;
  }

  if (attributionText) {
    cursorY += 22 * 0.85;
    parts.push(
      `<text x="${MARGIN}" y="${cursorY}" font-family="${fontFamily}" font-size="22" font-weight="600" fill="#FFFFFF" opacity="0.65" letter-spacing="1">${escapeXml(attributionText.toUpperCase())}</text>`,
    );
  }

  const categoryPill = `
    <g>
      <rect x="${MARGIN}" y="48" rx="18" ry="18" width="${Math.max(120, input.category.length * 15 + 48)}" height="36" fill="${branding.primaryColor}" opacity="0.92" />
      <text x="${MARGIN + 20}" y="72" font-family="${fontFamily}" font-size="18" font-weight="700" fill="#FFFFFF" letter-spacing="1.5">${escapeXml(input.category.replace(/_/g, " ").toUpperCase())}</text>
    </g>`;

  const wordmarkWidth = branding.wordmark.length * 12 + 32;
  const wordmark = `
    <g>
      <rect x="${SLIDE_WIDTH - MARGIN - wordmarkWidth}" y="48" rx="18" ry="18" width="${wordmarkWidth}" height="36" fill="#000000" opacity="0.4" />
      <text x="${SLIDE_WIDTH - MARGIN - wordmarkWidth / 2}" y="72" text-anchor="middle" font-family="${fontFamily}" font-size="18" font-weight="700" fill="#FFFFFF" letter-spacing="1">${escapeXml(branding.wordmark)}</text>
    </g>`;

  return `
    <svg width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${branding.backgroundColor}" stop-opacity="0" />
          <stop offset="${Math.round(gradientStartFrac * 100)}%" stop-color="${branding.backgroundColor}" stop-opacity="0" />
          <stop offset="${Math.round(Math.min(94, gradientStartFrac * 100 + 22))}%" stop-color="${branding.backgroundColor}" stop-opacity="0.88" />
          <stop offset="100%" stop-color="${branding.backgroundColor}" stop-opacity="0.96" />
        </linearGradient>
      </defs>
      <rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="#000000" opacity="0.14" />
      <rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="url(#fade)" />
      ${categoryPill}
      ${wordmark}
      ${parts.join("\n")}
    </svg>
  `;
}
