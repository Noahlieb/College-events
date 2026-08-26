import { bodyBoldFont, bodyRegularFont, displayFont } from "./fonts.js";
import { fitText, measureWidth, textPathElement, textToPathData } from "./textLayout.js";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type EventSlideInput } from "./types.js";

const MARGIN = 64;
const CONTENT_WIDTH = SLIDE_WIDTH - MARGIN * 2;
/** Bumped from 34 — the date is the first thing a viewer needs to register
 * on a carousel of slides, and it was getting lost next to the much larger
 * title even with the outline treatment. */
const DATE_FONT_SIZE = 38;

/**
 * White text over an arbitrary flyer photo, backed only by the bottom
 * gradient, disappears whenever that flyer happens to be bright or busy in
 * exactly the region the title lands — plenty of real flyers are white or
 * light-colored, and a long title can push past however far up the
 * gradient's fixed-height fade actually darkens. Rather than trying to
 * predict every flyer's brightness and re-tune the gradient's math for it,
 * every text path gets its own black outline: legible against literally
 * any background by construction, independent of what's under it.
 */
function outlinedFill(fill: string, fontSize: number, fillOpacity?: number): Record<string, string | number> {
  const attrs: Record<string, string | number> = {
    fill,
    stroke: "#000000",
    "stroke-width": Math.max(2, Math.round(fontSize * 0.08)),
    "stroke-linejoin": "round",
    "paint-order": "stroke fill",
  };
  if (fillOpacity !== undefined) attrs["fill-opacity"] = fillOpacity;
  return attrs;
}

/** Same attribute-string formatting textPathElement uses internally, for
 * the one spot (the category pill) that needs a hand-built <path> because
 * its `d` comes from textToPathData directly rather than through
 * textPathElement. */
function attrString(attrs: Record<string, string | number>): string {
  return Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");
}

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

  const dateH = input.date ? DATE_FONT_SIZE * 1.3 : 0;
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
    const dateText = input.date.toUpperCase();
    const dateTextWidth = measureWidth(bodyBold, dateText, DATE_FONT_SIZE);
    // A soft dark backing behind the date — same idea as the corner pills,
    // but low-opacity and hugging the text tightly rather than a hard
    // sticker, so it reads as "bolder" without breaking from the flyer
    // design the way an opaque pill would. The outline treatment alone
    // (still applied below) guarantees legibility; this backing is what
    // makes it the first thing your eye lands on instead of competing with
    // the photo behind it.
    parts.push(`
      <rect x="${MARGIN - 12}" y="${cursorY - DATE_FONT_SIZE * 0.82}" rx="8" ry="8"
        width="${dateTextWidth + 24}" height="${DATE_FONT_SIZE * 1.15}" fill="#000000" opacity="0.4" />
    `);
    parts.push(
      textPathElement(bodyBold, dateText, MARGIN, cursorY, DATE_FONT_SIZE, outlinedFill(branding.accentColor, DATE_FONT_SIZE)),
    );
    cursorY += dateH * 0.25 + gapAfterDate;
  }

  cursorY += title.fontSize * 0.88;
  parts.push(linesToPaths(display, title.lines, MARGIN, cursorY, titleLineH, title.fontSize, outlinedFill("#FFFFFF", title.fontSize)));
  cursorY += titleLineH * (title.lines.length - 1) + titleLineH * 0.3 + gapAfterTitle;

  if (meta) {
    cursorY += meta.fontSize * 0.85;
    parts.push(
      linesToPaths(bodyBold, meta.lines, MARGIN, cursorY, metaLineH, meta.fontSize, outlinedFill("#FFFFFF", meta.fontSize, 0.95)),
    );
    cursorY += metaLineH * (meta.lines.length - 1) + metaLineH * 0.3 + gapAfterMeta;
  }

  if (description) {
    cursorY += description.fontSize * 0.85;
    parts.push(
      linesToPaths(
        bodyRegular,
        description.lines,
        MARGIN,
        cursorY,
        descLineH,
        description.fontSize,
        outlinedFill("#FFFFFF", description.fontSize, 0.85),
      ),
    );
    cursorY += descLineH * (description.lines.length - 1) + descLineH * 0.3;
  }

  // Both corner pills sit directly on the photo with nothing else behind
  // them — a semi-transparent pill alone isn't reliably dark/light enough
  // against every flyer, so the text inside gets the same outline
  // treatment as the title, on top of a near-opaque pill rather than a
  // faint one.
  const categoryLabel = input.category.replace(/_/g, " ").toUpperCase();
  const categoryFontSize = 18;
  const categoryTextWidth = measureWidth(bodyBold, categoryLabel, categoryFontSize);
  const categoryPillWidth = Math.max(120, categoryTextWidth + 48);
  const categoryLabelPathD = textToPathData(bodyBold, categoryLabel, MARGIN + 20, 72, categoryFontSize);
  const categoryPill = `
    <g>
      <rect x="${MARGIN}" y="48" rx="18" ry="18" width="${categoryPillWidth}" height="36" fill="${branding.primaryColor}" opacity="0.97" />
      <path d="${categoryLabelPathD}" ${attrString(outlinedFill("#FFFFFF", categoryFontSize))} />
    </g>`;

  const wordmarkFontSize = 18;
  const wordmarkTextWidth = measureWidth(bodyBold, branding.wordmark, wordmarkFontSize);
  const wordmarkWidth = wordmarkTextWidth + 32;
  const wordmarkPillX = SLIDE_WIDTH - MARGIN - wordmarkWidth;
  const wordmark = `
    <g>
      <rect x="${wordmarkPillX}" y="48" rx="18" ry="18" width="${wordmarkWidth}" height="36" fill="#000000" opacity="0.7" />
      ${textPathElement(bodyBold, branding.wordmark, wordmarkPillX + (wordmarkWidth - wordmarkTextWidth) / 2, 72, wordmarkFontSize, outlinedFill("#FFFFFF", wordmarkFontSize))}
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
