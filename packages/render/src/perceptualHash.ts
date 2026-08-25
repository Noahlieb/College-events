import sharp from "sharp";

/**
 * dHash (difference hash) over actual pixels.
 *
 * Chosen over aHash (too fragile to brightness shifts, which re-encoding
 * causes constantly) and over pHash/DCT (more robust, but needs a DCT
 * implementation or another dependency for an accuracy gain we do not
 * need — we are matching re-encodes of the same file, not finding a
 * cropped detail inside a different photo).
 *
 * The image is reduced to 9×8 grayscale and each pixel compared with its
 * right-hand neighbour, giving 8×8 = 64 bits of "which way did brightness
 * step". That survives resizing, JPEG quality changes and mild recolouring
 * — exactly the transformations a flyer undergoes as it is reposted.
 */

const WIDTH = 9;
const HEIGHT = 8;

/** 16-character hex string (64 bits), or null if the buffer is not an image. */
export async function perceptualHash(image: Buffer): Promise<string | null> {
  let pixels: Buffer;
  try {
    pixels = await sharp(image)
      .greyscale()
      // `fit: "fill"` on purpose: preserving aspect ratio would make the
      // same flyer hash differently depending on how a platform cropped
      // its thumbnail.
      .resize(WIDTH, HEIGHT, { fit: "fill" })
      .raw()
      .toBuffer();
  } catch {
    // A candidate URL that turns out to be HTML, an SVG sharp cannot
    // rasterize, or a truncated download. Not being hashable is not an
    // error — the asset simply cannot be grouped with others.
    return null;
  }

  if (pixels.length < WIDTH * HEIGHT) return null;

  const bits: number[] = [];
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH - 1; col++) {
      const left = pixels[row * WIDTH + col]!;
      const right = pixels[row * WIDTH + col + 1]!;
      bits.push(left > right ? 1 : 0);
    }
  }

  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += ((bits[i]! << 3) | (bits[i + 1]! << 2) | (bits[i + 2]! << 1) | bits[i + 3]!).toString(16);
  }
  return hex;
}

export interface ImageFacts {
  perceptualHash: string | null;
  width: number | null;
  height: number | null;
  mime: string | null;
  bytes: number;
}

/**
 * Everything the flyer pipeline needs to rank one candidate: how it
 * compares to other images, how big it is, and what it weighs.
 *
 * Byte size matters as a tie-breaker between copies of identical
 * dimensions — the larger file is the less-compressed one.
 */
export async function inspectImage(image: Buffer): Promise<ImageFacts> {
  const facts: ImageFacts = {
    perceptualHash: await perceptualHash(image),
    width: null,
    height: null,
    mime: null,
    bytes: image.byteLength,
  };

  try {
    const metadata = await sharp(image).metadata();
    facts.width = metadata.width ?? null;
    facts.height = metadata.height ?? null;
    facts.mime = metadata.format ? `image/${metadata.format}` : null;
  } catch {
    // Dimensions are optional; a hashless, sizeless candidate still ranks
    // by classification and source trust.
  }
  return facts;
}
