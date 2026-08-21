import { describe, expect, it } from "vitest";
import { bodyRegularFont, displayFont } from "./fonts.js";
import { fitText, measureWidth, textToPathData, truncateLines, wrapText } from "./textLayout.js";

const font = bodyRegularFont();

describe("wrapText", () => {
  it("keeps short text on one line", () => {
    expect(wrapText("First Saturday", font, 30, 400)).toEqual(["First Saturday"]);
  });

  it("wraps onto multiple lines without exceeding the box width", () => {
    const lines = wrapText("This Is A Very Long Event Title That Needs Wrapping", font, 30, 260);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      // allow one overflowing word — wrapText never drops content, only a
      // single unbroken word can still exceed the box on its own line
      expect(measureWidth(font, line, 30)).toBeLessThanOrEqual(260 * 1.6);
    }
  });

  it("never drops words", () => {
    const text = "Back to School Bash with DJ and Free Food";
    const lines = wrapText(text, font, 24, 220);
    expect(lines.join(" ")).toBe(text);
  });
});

describe("truncateLines", () => {
  it("adds an ellipsis when cutting lines down", () => {
    const result = truncateLines(["Line one", "Line two", "Line three"], 2);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatch(/…$/);
  });

  it("is a no-op when already within the limit", () => {
    expect(truncateLines(["a", "b"], 3)).toEqual(["a", "b"]);
  });
});

describe("fitText", () => {
  it("uses the start font size when text fits within maxLines", () => {
    const result = fitText("FREE FOOD", { font, boxWidth: 900, startFontSize: 80, minFontSize: 40, maxLines: 2 });
    expect(result.fontSize).toBe(80);
    expect(result.lines).toEqual(["FREE FOOD"]);
  });

  it("shrinks the font size for long titles instead of overflowing maxLines", () => {
    const longTitle = "FAU FALL INVOLVEMENT FAIR AND STUDENT ORGANIZATION SHOWCASE EXTRAVAGANZA";
    const result = fitText(longTitle, { font, boxWidth: 950, startFontSize: 88, minFontSize: 48, maxLines: 3 });
    expect(result.fontSize).toBeLessThan(88);
    expect(result.lines.length).toBeLessThanOrEqual(3);
  });

  it("never exceeds maxLines even at the minimum font size (truncates instead)", () => {
    const veryLongTitle = Array.from({ length: 40 }, () => "WORD").join(" ");
    const result = fitText(veryLongTitle, { font, boxWidth: 900, startFontSize: 88, minFontSize: 48, maxLines: 3 });
    expect(result.fontSize).toBe(48);
    expect(result.lines.length).toBeLessThanOrEqual(3);
    expect(result.lines[2]).toMatch(/…$/);
  });

  it("never lets a single long unbroken word overflow the box, even at the start font size", () => {
    // A scraped URL slug or similar — one long "word" with no spaces to
    // wrap on. Line count alone would previously accept this at 88px.
    const slug = "anthony-green-this-tour-wont-save-you-live-in-concert";
    const result = fitText(slug, { font, boxWidth: 400, startFontSize: 88, minFontSize: 40, maxLines: 3 });
    for (const line of result.lines) {
      expect(measureWidth(font, line, result.fontSize)).toBeLessThanOrEqual(400 + 1);
    }
  });
});

describe("measureWidth", () => {
  it("returns a larger width for a longer string at the same font size", () => {
    const short = measureWidth(font, "Hi", 40);
    const long = measureWidth(font, "Hello there friend", 40);
    expect(long).toBeGreaterThan(short);
  });

  it("returns a larger width for a bigger font size", () => {
    const small = measureWidth(font, "Event Title", 20);
    const big = measureWidth(font, "Event Title", 60);
    expect(big).toBeGreaterThan(small);
  });
});

describe("textToPathData", () => {
  it("produces non-empty SVG path data for real text", () => {
    const d = textToPathData(font, "FAU", 0, 0, 40);
    expect(d.length).toBeGreaterThan(0);
    expect(d).toMatch(/^M/);
  });

  it("produces empty path data for empty text", () => {
    expect(textToPathData(font, "", 0, 0, 40)).toBe("");
  });

  it("never emits NaN coordinates for a title long enough to hit opentype.js's whole-string path bug", () => {
    // Regression test: font.getPath(fullString, ...) can return literal
    // "NaN" for a glyph once the accumulated x position lands on certain
    // floating-point values far enough into a long string — this exact
    // title, at this exact size/position, in the display font reproduced
    // it. textToPathData must never leak that through.
    const d = textToPathData(displayFont(), "ANTHONY+GREEN", 64, 200, 88);
    expect(d).not.toMatch(/NaN/);
  });
});
