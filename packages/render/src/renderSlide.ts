import sharp from "sharp";
import { generatePlaceholderBackground } from "./placeholder.js";
import { buildEventSlideOverlaySvg } from "./svgTemplate.js";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type EventSlideInput } from "./types.js";

/**
 * Renders one branded 1080x1350 Instagram slide for a single event (spec
 * §18). Deterministic and template-based: the source photo (when present)
 * is never smart-cropped — many source images (Posh.vip flyers, team
 * logos) already have their own baked-in text or mark filling the frame,
 * and a saliency-based crop can slice that off. Instead the full image is
 * fit inside the frame untouched, backed by a blurred/darkened copy of
 * itself scaled to fill any letterboxed edges, so nothing is ever cropped
 * away. Our own text is then composited on top via a gradient + SVG
 * overlay, not baked into a regenerated image.
 */
export async function renderEventSlide(input: EventSlideInput): Promise<Buffer> {
  const background = await resolveBackgroundImage(input.image, input.category);

  const backdrop = await sharp(background)
    .resize(SLIDE_WIDTH, SLIDE_HEIGHT, { fit: "cover", position: "attention" })
    .blur(48)
    .modulate({ brightness: 0.55 })
    .toBuffer();

  const foreground = await sharp(background)
    .resize(SLIDE_WIDTH, SLIDE_HEIGHT, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const composed = await sharp(backdrop)
    .composite([{ input: foreground, top: 0, left: 0 }])
    .toBuffer();

  const overlaySvg = buildEventSlideOverlaySvg(input);

  return sharp(composed)
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * Resolves the source photo, falling back to the category placeholder both
 * when none was supplied and when what was supplied turns out not to be a
 * real, decodable image.
 *
 * The second case is the one that matters here: an upstream fetch (see
 * apps/worker's attachFlyerFromUrl) can succeed at the HTTP level — 200 OK
 * — while the response body is an error page, a truncated download, or
 * some format Sharp can't decode. Every image that reaches this function
 * has already passed a content-type check upstream, but that check can
 * only catch a server lying about what it's sending, not a body that's
 * simply corrupt. `sharp(...).metadata()` is the cheap way to actually
 * open it, so a bad buffer degrades to the placeholder — same as no image
 * at all — instead of throwing partway through compositing and taking the
 * rest of the post's render down with it (one bad flyer among nine
 * shouldn't fail the other eight).
 */
async function resolveBackgroundImage(image: Buffer | null, category: string): Promise<Buffer> {
  if (image) {
    try {
      await sharp(image).metadata();
      return image;
    } catch {
      // fall through to the placeholder
    }
  }
  return generatePlaceholderBackground(category);
}
