import sharp from "sharp";
import { generatePlaceholderBackground } from "./placeholder.js";
import { buildEventSlideOverlaySvg } from "./svgTemplate.js";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type EventSlideInput } from "./types.js";

/**
 * Renders one branded 1080x1350 Instagram slide for a single event (spec
 * §18). Deterministic and template-based: the source photo (when present)
 * is smart-cropped to fill the frame, never stretched, and the original
 * artwork stays the dominant visual — text is composited on top via a
 * gradient + SVG overlay, not baked into a regenerated image.
 */
export async function renderEventSlide(input: EventSlideInput): Promise<Buffer> {
  const background = input.image ?? (await generatePlaceholderBackground(input.category));

  const cropped = await sharp(background)
    .resize(SLIDE_WIDTH, SLIDE_HEIGHT, { fit: "cover", position: "attention" })
    .toBuffer();

  const overlaySvg = buildEventSlideOverlaySvg(input);

  return sharp(cropped)
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
