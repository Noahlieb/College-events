import sharp from "sharp";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "./types.js";

/** Category-tinted gradient pairs used when no source photo is available. */
const CATEGORY_GRADIENTS: Record<string, [string, string]> = {
  campus: ["#7A1F2B", "#2A0A12"],
  student_org: ["#7A1F2B", "#2A0A12"],
  sports: ["#0A2A55", "#050B14"],
  concert: ["#5B2A86", "#1A0B2E"],
  nightlife: ["#8A1350", "#1A0512"],
  party: ["#8A1350", "#1A0512"],
  food_drink: ["#8A5A12", "#2E1D06"],
  fitness: ["#12664B", "#052018"],
  comedy: ["#7A4A12", "#2A1806"],
  festival: ["#B3591F", "#2E1204"],
  career: ["#2A4A7A", "#0A1424"],
  academic: ["#2A4A7A", "#0A1424"],
  networking: ["#2A4A7A", "#0A1424"],
  community: ["#2A6A4A", "#0A2418"],
  dating: ["#8A2A5A", "#2A0A1A"],
  other: ["#3A3A44", "#0F0F14"],
};

/**
 * Generates an abstract category-tinted backdrop for events with no source
 * photo, so the render pipeline never breaks on a missing image and every
 * slide still looks intentional rather than blank (spec §18).
 */
export async function generatePlaceholderBackground(category: string): Promise<Buffer> {
  const [from, to] = CATEGORY_GRADIENTS[category] ?? CATEGORY_GRADIENTS.other!;
  const svg = `
    <svg width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${from}" />
          <stop offset="100%" stop-color="${to}" />
        </linearGradient>
        <radialGradient id="glow" cx="30%" cy="25%" r="60%">
          <stop offset="0%" stop-color="${from}" stop-opacity="0.55" />
          <stop offset="100%" stop-color="${from}" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="url(#bg)" />
      <rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="url(#glow)" />
    </svg>
  `;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}
