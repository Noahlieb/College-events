import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRecords, pickField } from "./csv.js";

describe("parseCsv", () => {
  it("parses simple comma-separated rows", () => {
    const rows = parseCsv("a,b,c\n1,2,3");
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields containing commas", () => {
    const rows = parseCsv('name,venue\nSOAR Fair,"3045 N Federal Hwy, Fort Lauderdale"');
    expect(rows[1]).toEqual(["SOAR Fair", "3045 N Federal Hwy, Fort Lauderdale"]);
  });

  it("handles doubled-quote escaping inside a quoted field", () => {
    const rows = parseCsv('name\n"Hoot\'s ""Big"" Party"');
    expect(rows[1]).toEqual(['Hoot\'s "Big" Party']);
  });

  it("handles CRLF line endings", () => {
    const rows = parseCsv("a,b\r\n1,2\r\n3,4");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles a file with no trailing newline", () => {
    const rows = parseCsv("a,b\n1,2");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseCsvRecords", () => {
  it("maps rows to header-keyed records", () => {
    const records = parseCsvRecords("Event,Date\nSOAR Fair,2026-08-19");
    expect(records).toEqual([{ Event: "SOAR Fair", Date: "2026-08-19" }]);
  });

  it("returns an empty array for an empty input", () => {
    expect(parseCsvRecords("")).toEqual([]);
  });

  it("fills missing trailing columns with empty strings", () => {
    const records = parseCsvRecords("Event,Date,Notes\nSOAR Fair,2026-08-19");
    expect(records[0]!.Notes).toBe("");
  });
});

describe("pickField", () => {
  it("matches case- and whitespace-insensitively across aliases", () => {
    const record = { "Time (ET)": "9:00 AM" };
    expect(pickField(record, "Time", "time (et)")).toBe("9:00 AM");
  });

  it("returns an empty string when no alias matches", () => {
    expect(pickField({ Event: "x" }, "Date", "date")).toBe("");
  });
});
