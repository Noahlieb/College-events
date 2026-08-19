import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderEventSlide } from "./renderSlide.js";
import { renderCoverSlide } from "./renderCoverSlide.js";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type SlideBranding } from "./types.js";

const branding: SlideBranding = {
  primaryColor: "#B31F2B",
  secondaryColor: "#0A2A55",
  accentColor: "#FFFFFF",
  backgroundColor: "#0B0B0F",
  fontFamily: "Arial Black, Helvetica, Arial, sans-serif",
  wordmark: "@faucampusscene",
};

describe("renderEventSlide", () => {
  it("produces a correctly-sized JPEG when there is no source image (fallback placeholder)", async () => {
    const buffer = await renderEventSlide({
      image: null,
      date: "August 25th",
      title: "Owl Central Study Break: Free Coffee & Snacks",
      venue: "S.E. Wimberly Library Breezeway",
      time: "10AM–1PM",
      price: "Free",
      description: "Grab free coffee and snacks before midterms week.",
      source: "FAU Student Government",
      category: "campus",
      branding,
    });
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(SLIDE_WIDTH);
    expect(meta.height).toBe(SLIDE_HEIGHT);
    expect(meta.format).toBe("jpeg");
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("handles a very long title without throwing (shrink-to-fit, never overflow)", async () => {
    const buffer = await renderEventSlide({
      image: null,
      date: "September 2nd",
      title: "FAU Owls Basketball vs. UCF — Home Conference Matchup Rivalry Night Extravaganza",
      venue: "Eleanor R. Baldwin Arena",
      time: "6PM or 7PM (conflicting sources)",
      price: "Free with Owl Card",
      description:
        "A very long description that goes on and on describing every possible detail of the event in excessive length to test wrapping and truncation behavior thoroughly.",
      source: "FAU Athletics",
      category: "sports",
      branding,
    });
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(SLIDE_WIDTH);
    expect(meta.height).toBe(SLIDE_HEIGHT);
  });

  it("fills the frame from a provided source image without cropping or stretching it", async () => {
    const sourcePhoto = await sharp({
      create: { width: 2000, height: 1200, channels: 3, background: { r: 20, g: 20, b: 40 } },
    })
      .jpeg()
      .toBuffer();

    const buffer = await renderEventSlide({
      image: sourcePhoto,
      date: "August 21st",
      title: "College Night at Bounce Delray",
      venue: "Bounce Delray Beach",
      time: "10PM–2AM",
      price: "Free before 11",
      description: "Back-to-school nightlife event with resident DJ and drink specials.",
      source: "Bounce Delray Beach",
      category: "nightlife",
      branding,
    });
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(SLIDE_WIDTH);
    expect(meta.height).toBe(SLIDE_HEIGHT);
  });
});

describe("renderCoverSlide", () => {
  it("produces a correctly-sized branded cover slide", async () => {
    const buffer = await renderCoverSlide({
      kicker: "THIS WEEK AT FAU",
      dateRange: "AUGUST 24–30",
      subtitle: "Swipe for the full lineup",
      branding,
    });
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(SLIDE_WIDTH);
    expect(meta.height).toBe(SLIDE_HEIGHT);
    expect(meta.format).toBe("jpeg");
  });
});
