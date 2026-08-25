import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { hammingDistance, imagesMatch } from "@college-events/core";
import { inspectImage, perceptualHash } from "./perceptualHash.js";

/** A deterministic test image: a gradient with a distinctive block. */
async function testImage(options: {
  width?: number;
  height?: number;
  quality?: number;
  hue?: number;
} = {}): Promise<Buffer> {
  const width = options.width ?? 400;
  const height = options.height ?? 400;
  const hue = options.hue ?? 200;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue},80%,20%)"/>
      <stop offset="100%" stop-color="hsl(${hue},80%,80%)"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="10%" y="20%" width="45%" height="30%" fill="#ffffff"/>
    <circle cx="75%" cy="70%" r="15%" fill="#000000"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: options.quality ?? 90 }).toBuffer();
}

describe("perceptualHash", () => {
  it("produces a 64-bit hash as 16 hex characters", async () => {
    const hash = await perceptualHash(await testImage());
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable for the same bytes", async () => {
    const image = await testImage();
    expect(await perceptualHash(image)).toBe(await perceptualHash(image));
  });

  it("matches a resized copy of the same flyer", async () => {
    // The case that matters: the organizer's page has the full-size flyer,
    // a ticketing platform has a thumbnail of it.
    const full = await perceptualHash(await testImage({ width: 1200, height: 1200 }));
    const thumb = await perceptualHash(await testImage({ width: 240, height: 240 }));
    expect(imagesMatch(full!, thumb!)).toBe(true);
  });

  it("matches a heavily re-compressed copy", async () => {
    const clean = await perceptualHash(await testImage({ quality: 95 }));
    const crunchy = await perceptualHash(await testImage({ quality: 25 }));
    expect(imagesMatch(clean!, crunchy!)).toBe(true);
  });

  it("does not match a genuinely different image", async () => {
    const flyer = await perceptualHash(await testImage({ hue: 200 }));
    const other = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .jpeg()
      .toBuffer()
      .then(perceptualHash);
    expect(imagesMatch(flyer!, other!)).toBe(false);
  });

  it("survives a change of aspect ratio, since platforms crop thumbnails", async () => {
    const square = await perceptualHash(await testImage({ width: 600, height: 600 }));
    const wide = await perceptualHash(await testImage({ width: 900, height: 600 }));
    // Not required to match, but must not throw and must stay comparable.
    expect(hammingDistance(square!, wide!)).toBeGreaterThanOrEqual(0);
  });

  it("returns null rather than throwing for something that is not an image", async () => {
    // Candidate URLs that turn out to be HTML are routine.
    expect(await perceptualHash(Buffer.from("<html>not an image</html>"))).toBeNull();
  });

  it("returns null for an empty buffer", async () => {
    expect(await perceptualHash(Buffer.alloc(0))).toBeNull();
  });
});

describe("inspectImage", () => {
  it("reports the facts the flyer pipeline ranks on", async () => {
    const facts = await inspectImage(await testImage({ width: 800, height: 600 }));
    expect(facts.width).toBe(800);
    expect(facts.height).toBe(600);
    expect(facts.mime).toBe("image/jpeg");
    expect(facts.bytes).toBeGreaterThan(0);
    expect(facts.perceptualHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("still reports byte size for an unreadable file", async () => {
    // A hashless, sizeless candidate can still be ranked by classification
    // and source trust — it should not be discarded.
    const facts = await inspectImage(Buffer.from("not an image"));
    expect(facts.perceptualHash).toBeNull();
    expect(facts.width).toBeNull();
    expect(facts.bytes).toBeGreaterThan(0);
  });

  it("distinguishes two sizes of the same artwork by pixel count", async () => {
    const small = await inspectImage(await testImage({ width: 300, height: 300 }));
    const large = await inspectImage(await testImage({ width: 1500, height: 1500 }));
    expect(imagesMatch(small.perceptualHash!, large.perceptualHash!)).toBe(true);
    expect(large.width! * large.height!).toBeGreaterThan(small.width! * small.height!);
  });
});
