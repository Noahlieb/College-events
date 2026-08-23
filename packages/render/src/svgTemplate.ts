import { bodyBoldFont, bodyRegularFont, displayFont } from "./fonts.js";
import { fitText, measureWidth, textPathElement, textToPathData } from "./textLayout.js";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type EventSlideInput } from "./types.js";

const MARGIN = 64;
const CONTENT_WIDTH = SLIDE_WIDTH - MARGIN * 2;

function linesToPaths(
  font: ReturnType<typeof displayFont>,
  lines: string[],
  x: number,
  startY: number,
  lineHeight: number,
  fontSize: number,
  attrs: Record<string, string | number>,
): string {
  return lines.map((line, i) => textPathElement(font, line, x, startY + i * lineHeight, fontSize, attrs)).join("\n");
}

/**
 * Builds the branded text/gradient overlay for one event slide as a
 * self-contained SVG string, composited on top of the (photo or placeholder)
 * background by renderSlide.ts. Bottom-anchored stacked layout, in the
 * spirit of the reference style described in spec §18/§53: hero image
 * intact, dark gradient rising from the bottom, condensed title, then
 * date/venue/time/price/description in descending emphasis.
 *
 * Every piece of text is outlined to an SVG path via the bundled fonts
 * (fonts.ts) rather than rendered as `<text>` — see fonts.ts for why.
 */
export function buildEventSlideOverlaySvg(input: EventSlideInput): string {
  const { branding } = input;
  const display = displayFont();
  const bodyBold = bodyBoldFont();
  const bodyRegular = bodyRegularFont();

  const title = fitText(input.title.toUpperCase(), {
    font: display,
    boxWidth: CONTENT_WIDTH,
    startFontSize: 88,
    minFontSize: 48,
    maxLines: 3,
  });

  const metaParts = [input.venue, input.time, input.price].filter(Boolean) as string[];
  const meta = metaParts.length
    ? fitText(metaParts.join("   •   "), { font: bodyBold, boxWidth: CONTENT_WIDTH, startFontSize: 34, minFontSize: 24, maxLines: 2 })
    : null;

  const description = input.description
    ? fitText(input.description, { font: bodyRegular, boxWidth: CONTENT_WIDTH, startFontSize: 30, minFontSize: 24, maxLines: 2 })
    : null;

  // ── compute stacked block heights (top to bottom) ──
  //
  // Gaps are only reserved when something actually follows, and the final
  // block's trailing leading is swapped for a fixed descender pad. Without
  // both, the bottom margin depends on which block happens to end the stack:
  // a slide with no description sat 86px off the bottom and a title-only one
  // 103px, against the 64px margin every other edge uses.
  const titleLineH = title.fontSize * 1.08;
  const metaLineH = (meta?.fontSize ?? 0) * 1.35;
  const descLineH = (description?.fontSize ?? 0) * 1.4;

  const dateH = input.date ? 34 * 1.3 : 0;
  const gapAfterDate = input.date ? 14 : 0;
  const titleH = title.lines.length * titleLineH;
  const gapAfterTitle = meta || description ? 22 : 0;
  const metaH = meta ? meta.lines.length * metaLineH : 0;
  const gapAfterMeta = meta && description ? 16 : 0;
  const descH = description ? description.lines.length * descLineH : 0;

  /** Leading below the last baseline, which no following block will use. */
  const trailingSlack = description ? descLineH * 0.3 : meta ? metaLineH * 0.3 : titleLineH * 0.3;
  /** Enough room for descenders (g, y, p) without touching the frame edge. */
  const DESCENDER_PAD = 10;

  const totalContentH =
    dateH + gapAfterDate + titleH + gapAfterTitle + metaH + gapAfterMeta + descH - trailingSlack + DESCENDER_PAD;
  const gradientStartFrac = Math.min(0.72, Math.max(0.32, 1 - (totalContentH + MARGIN * 1.6) / SLIDE_HEIGHT));

  let cursorY = SLIDE_HEIGHT - MARGIN - totalContentH;

  const parts: string[] = [];

  if (input.date) {
    cursorY += dateH * 0.75; // move to baseline for this block
    parts.push(textPathElement(bodyBold, input.date.toUpperCase(), MARGIN, cursorY, 34, { fill: branding.accentColor }));
    cursorY += dateH * 0.25 + gapAfterDate;
  }

  cursorY += title.fontSize * 0.88;
  parts.push(linesToPaths(display, title.lines, MARGIN, cursorY, titleLineH, title.fontSize, { fill: "#FFFFFF" }));
  cursorY += titleLineH * (title.lines.length - 1) + titleLineH * 0.3 + gapAfterTitle;

  if (meta) {
    cursorY += meta.fontSize * 0.85;
    parts.push(linesToPaths(bodyBold, meta.lines, MARGIN, cursorY, metaLineH, meta.fontSize, { fill: "#FFFFFF", opacity: 0.95 }));
    cursorY += metaLineH * (meta.lines.length - 1) + metaLineH * 0.3 + gapAfterMeta;
  }

  if (description) {
    cursorY += description.fontSize * 0.85;
    parts.push(
      linesToPaths(bodyRegular, description.lines, MARGIN, cursorY, descLineH, description.fontSize, { fill: "#FFFFFF", opacity: 0.85 }),
    );
    cursorY += descLineH * (description.lines.length - 1) + descLineH * 0.3;
  }

  const categoryLabel = input.category.replace(/_/g, " ").toUpperCase();
  const categoryFontSize = 18;
  const categoryTextWidth = measureWidth(bodyBold, categoryLabel, categoryFontSize);
  const categoryPillWidth = Math.max(120, categoryTextWidth + 48);
  const categoryLabelPathD = textToPathData(bodyBold, categoryLabel, MARGIN + 20, 72, categoryFontSize);
  const categoryPill = `
    <g>
      <rect x="${MARGIN}" y="48" rx="18" ry="18" width="${categoryPillWidth}" height="36" fill="${branding.primaryColor}" opacity="0.92" />
      <path d="${categoryLabelPathD}" fill="#FFFFFF" />
    </g>`;

  const wordmarkFontSize = 18;
  const wordmarkTextWidth = measureWidth(bodyBold, branding.wordmark, wordmarkFontSize);
  const wordmarkWidth = wordmarkTextWidth + 32;
  const wordmarkPillX = SLIDE_WIDTH - MARGIN - wordmarkWidth;
  const wordmark = `
    <g>
      <rect x="${wordmarkPillX}" y="48" rx="18" ry="18" width="${wordmarkWidth}" height="36" fill="#000000" opacity="0.4" />
      ${textPathElement(bodyBold, branding.wordmark, wordmarkPillX + (wordmarkWidth - wordmarkTextWidth) / 2, 72, wordmarkFontSize, { fill: "#FFFFFF" })}
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
