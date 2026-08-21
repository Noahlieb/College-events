/**
 * Minimal RFC 4180-ish CSV parser: quoted fields, embedded commas,
 * doubled-quote escaping (`""` -> `"`), and CRLF/LF line endings.
 * Deliberately dependency-free, same rationale as ical.ts's hand-rolled
 * VEVENT parser — the format is simple enough that a small parser is
 * easier to reason about and test than pulling in a library.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  // Flush the final field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Parses a CSV into header-keyed records. Header matching is
 * case-insensitive and whitespace-trimmed so minor spreadsheet-export
 * variations (" Event ", "event") still line up. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      record[header] = (row[i] ?? "").trim();
    });
    return record;
  });
}

/** Case/whitespace-insensitive lookup — spreadsheet exports vary column
 * naming slightly ("Time (ET)" vs "Time"), so callers pass every accepted
 * alias for a field and get the first one present in the record. */
export function pickField(record: Record<string, string>, ...aliases: string[]): string {
  const normalized = new Map(Object.entries(record).map(([k, v]) => [k.trim().toLowerCase(), v]));
  for (const alias of aliases) {
    const value = normalized.get(alias.toLowerCase());
    if (value) return value;
  }
  return "";
}
