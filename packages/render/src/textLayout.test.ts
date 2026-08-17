import { describe, expect, it } from "vitest";
import { fitText, maxCharsForWidth, truncateLines, wrapText } from "./textLayout.js";

describe("wrapText", () => {
  it("keeps short text on one line", () => {
    expect(wrapText("First Saturday", 30)).toEqual(["First Saturday"]);
  });

  it("wraps onto multiple lines without exceeding the character budget", () => {
    const lines = wrapText("This Is A Very Long Event Title That Needs Wrapping", 20);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20 + 15); // allow one overflowing word
  });

  it("never drops words", () => {
    const text = "Back to School Bash with DJ and Free Food";
    const lines = wrapText(text, 15);
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
    const result = fitText("FREE FOOD", { boxWidth: 900, startFontSize: 80, minFontSize: 40, maxLines: 2 });
    expect(result.fontSize).toBe(80);
    expect(result.lines).toEqual(["FREE FOOD"]);
  });

  it("shrinks the font size for long titles instead of overflowing maxLines", () => {
    const longTitle = "FAU FALL INVOLVEMENT FAIR AND STUDENT ORGANIZATION SHOWCASE EXTRAVAGANZA";
    const result = fitText(longTitle, { boxWidth: 950, startFontSize: 88, minFontSize: 48, maxLines: 3 });
    expect(result.fontSize).toBeLessThan(88);
    expect(result.lines.length).toBeLessThanOrEqual(3);
  });

  it("never exceeds maxLines even at the minimum font size (truncates instead)", () => {
    const veryLongTitle = Array.from({ length: 40 }, () => "WORD").join(" ");
    const result = fitText(veryLongTitle, { boxWidth: 900, startFontSize: 88, minFontSize: 48, maxLines: 3 });
    expect(result.fontSize).toBe(48);
    expect(result.lines.length).toBeLessThanOrEqual(3);
    expect(result.lines[2]).toMatch(/…$/);
  });
});

describe("maxCharsForWidth", () => {
  it("returns more characters for a wider box or smaller font", () => {
    const narrow = maxCharsForWidth(500, 40);
    const wide = maxCharsForWidth(1000, 40);
    expect(wide).toBeGreaterThan(narrow);
    const smallFont = maxCharsForWidth(500, 20);
    expect(smallFont).toBeGreaterThan(narrow);
  });
});
