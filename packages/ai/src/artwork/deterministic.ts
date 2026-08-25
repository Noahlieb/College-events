import {
  ARTWORK_HEIGHT,
  ARTWORK_WIDTH,
  buildArtworkPrompt,
  type ArtworkEventFacts,
  type EventArtworkGenerator,
  type GeneratedEventAsset,
} from "./types.js";

/**
 * A generator that draws a category-tinted gradient instead of calling a
 * model.
 *
 * This is the default, and it is not a stub. Most deployments will run
 * without an image-generation key, and the alternative to this is a slide
 * with nothing behind the text. It is also what makes the fallback
 * pipeline testable end to end without spending money or needing network.
 *
 * It reports `isAiGenerated` truthfully via its provider name: nothing
 * here involves a model, so an operator reviewing "why does this event
 * have generated art" gets an honest answer.
 */

const CATEGORY_COLOURS: Record<string, [string, string]> = {
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

/** Stable per-event variation, so two events in one category differ. */
function seedFrom(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export class DeterministicArtworkGenerator implements EventArtworkGenerator {
  readonly name = "deterministic";
  readonly model = "gradient-v1";

  async generate(event: ArtworkEventFacts): Promise<GeneratedEventAsset> {
    const [from, to] = CATEGORY_COLOURS[event.category] ?? CATEGORY_COLOURS.other!;
    const seed = seedFrom(event.id);
    const angle = seed % 360;
    const blobX = 20 + (seed % 60);
    const blobY = 15 + ((seed >> 3) % 55);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ARTWORK_WIDTH}" height="${ARTWORK_HEIGHT}">
  <defs>
    <linearGradient id="bg" gradientTransform="rotate(${angle} 0.5 0.5)">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
    <radialGradient id="glow">
      <stop offset="0%" stop-color="${from}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${from}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <circle cx="${blobX}%" cy="${blobY}%" r="42%" fill="url(#glow)"/>
  <circle cx="${100 - blobX}%" cy="${blobY / 2}%" r="26%" fill="url(#glow)" opacity="0.6"/>
</svg>`;

    // sharp is a peer of the render package; rasterising here would pull a
    // native dependency into every consumer of @college-events/ai. SVG is
    // a valid image the storage layer and renderer both accept.
    return {
      image: Buffer.from(svg, "utf8"),
      mime: "image/svg+xml",
      width: ARTWORK_WIDTH,
      height: ARTWORK_HEIGHT,
      provider: this.name,
      model: this.model,
      prompt: buildArtworkPrompt(event),
      generatedAt: new Date(),
    };
  }
}
