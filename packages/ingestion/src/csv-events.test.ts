import { describe, expect, it } from "vitest";
import { parseEventsCsv } from "./csv-events.js";

const HEADER = "Date,Day,Time (ET),Category,Event,Presenter/Team,Venue,Notes,Image URL,Image File,Link";

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("parseEventsCsv", () => {
  it("parses a well-formed campus row", () => {
    const { rows, errors } = parseEventsCsv(
      csv(
        '2026-08-19,Wed,9:00 AM–11:00 AM,Campus,SOAR Fair,FAU Library,"John D. MacArthur Campus Library",Free food & giveaways,https://example.com/img.png,file.svg,https://fau.campuslabs.com/engage/event/12555417',
      ),
      { defaultCity: "Boca Raton", submittedBy: "test" },
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    const { input } = rows[0]!;
    expect(input.name).toBe("SOAR Fair");
    expect(input.date).toBe("2026-08-19");
    expect(input.startTime).toBe("09:00");
    expect(input.endTime).toBe("11:00");
    expect(input.category).toBe("campus");
    expect(input.organization).toBe("FAU Library");
    expect(input.flyerUrl).toBe("https://example.com/img.png");
    expect(input.sourceUrl).toBe("https://fau.campuslabs.com/engage/event/12555417");
  });

  it("parses a single time with no range", () => {
    const { rows } = parseEventsCsv(
      csv('2026-08-22,Sat,7:30 PM,Sports,Volleyball: FAU vs Merrimack,FAU Athletics,"Baldwin Arena, Boca Raton",Home,,,https://fausports.com'),
      { defaultCity: "Boca Raton", submittedBy: "test" },
    );
    expect(rows[0]!.input.startTime).toBe("19:30");
    expect(rows[0]!.input.endTime).toBeNull();
  });

  it("prefers a 'Concert' note over a broad Nightlife category bucket", () => {
    const { rows } = parseEventsCsv(
      csv('2026-08-22,Sat,7:30 PM,Nightlife,Buckcherry,Culture Room,"Culture Room, Fort Lauderdale",Concert,,,https://www.cultureroom.net/'),
      { defaultCity: "Boca Raton", submittedBy: "test" },
    );
    expect(rows[0]!.input.category).toBe("concert");
  });

  it("falls back to the Nightlife bucket when Notes gives no stronger signal", () => {
    const { rows } = parseEventsCsv(
      csv('2026-08-27,Thu,9:00 PM,Nightlife,Thirsty Thursdays (21+),Tin Roof,Fort Lauderdale,Recurring weekly,,,https://www.visitlauderdale.com/nightlife/'),
      { defaultCity: "Boca Raton", submittedBy: "test" },
    );
    expect(rows[0]!.input.category).toBe("nightlife");
    expect(rows[0]!.input.ageRequirement).toBe("21+");
    expect(rows[0]!.input.isRecurring).toBe(true);
  });

  it("splits venue and city on the trailing comma", () => {
    const { rows } = parseEventsCsv(
      csv('2026-08-23,Sun,6:00 PM,Sports,Men\'s Soccer vs UCF,FAU Athletics,"FAU Soccer Stadium, Boca Raton",Home,,,https://fausports.com'),
      { defaultCity: "Jupiter", submittedBy: "test" },
    );
    expect(rows[0]!.input.venue).toBe("FAU Soccer Stadium");
    expect(rows[0]!.input.city).toBe("Boca Raton");
  });

  it("treats a bare 'City, ST' venue as the city itself, not a venue name", () => {
    const { rows } = parseEventsCsv(csv("2026-08-20,Thu,7:00 PM,Sports,Women's Soccer at Florida State,FAU Athletics,\"Tallahassee, FL\",Away,,,https://fausports.com"), {
      defaultCity: "Boca Raton",
      submittedBy: "test",
    });
    expect(rows[0]!.input.city).toBe("Tallahassee");
  });

  it("reports a row-level error for a missing Event name instead of throwing", () => {
    const { rows, errors } = parseEventsCsv(csv(",Wed,9:00 AM,Campus,,FAU Library,Library,Notes,,,https://x.com"), {
      defaultCity: "Boca Raton",
      submittedBy: "test",
    });
    expect(rows).toHaveLength(0);
    expect(errors).toEqual([{ rowNumber: 1, reason: "missing Event/Name" }]);
  });

  it("reports a row-level error for an unparseable date", () => {
    const { errors } = parseEventsCsv(csv("08/19/2026,Wed,9:00 AM,Campus,SOAR Fair,FAU Library,Library,Notes,,,https://x.com"), {
      defaultCity: "Boca Raton",
      submittedBy: "test",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.reason).toContain("Date");
  });

  it("reports a row-level error for an unparseable time", () => {
    const { errors } = parseEventsCsv(csv("2026-08-19,Wed,TBD,Campus,SOAR Fair,FAU Library,Library,Notes,,,https://x.com"), {
      defaultCity: "Boca Raton",
      submittedBy: "test",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.reason).toContain("Time");
  });

  it("continues past a bad row and still parses the good ones", () => {
    const { rows, errors } = parseEventsCsv(
      csv(
        "2026-08-19,Wed,9:00 AM,Campus,SOAR Fair,FAU Library,Library,Notes,,,https://x.com",
        ",Thu,7:00 PM,Sports,,FAU Athletics,Stadium,Notes,,,https://x.com",
        "2026-08-20,Fri,7:00 PM,Sports,Men's Soccer,FAU Athletics,Stadium,Notes,,,https://x.com",
      ),
      { defaultCity: "Boca Raton", submittedBy: "test" },
    );
    expect(rows).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rowNumber).toBe(2);
  });
});

describe("parseEventsCsv — University column (multi-school uploads)", () => {
  const MULTI_HEADER =
    "Date,Day,Time (ET),Category,Event,Presenter/Team,Venue,Notes,Image URL,Image File,Link,University";
  function multiCsv(...rows: string[]): string {
    return [MULTI_HEADER, ...rows].join("\n");
  }

  it("carries a per-row University value as universityHint", () => {
    const { rows } = parseEventsCsv(
      multiCsv(
        "2026-08-19,Wed,9:00 AM,Campus,SOAR Fair,FAU Library,Library,Notes,,,https://x.com,FAU",
        "2026-08-20,Thu,7:00 PM,Nightlife,Knight Party,Some Promoter,Downtown,Notes,,,https://x.com,UCF",
      ),
      { defaultCity: "Boca Raton", submittedBy: "test" },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.universityHint).toBe("FAU");
    expect(rows[1]!.universityHint).toBe("UCF");
  });

  it("leaves universityHint null when the column is absent — single-school CSVs are unaffected", () => {
    const { rows } = parseEventsCsv(
      csv("2026-08-19,Wed,9:00 AM,Campus,SOAR Fair,FAU Library,Library,Notes,,,https://x.com"),
      { defaultCity: "Boca Raton", submittedBy: "test" },
    );
    expect(rows[0]!.universityHint).toBeNull();
  });

  it("leaves universityHint null when the column exists but a row's cell is blank", () => {
    const { rows } = parseEventsCsv(
      multiCsv("2026-08-19,Wed,9:00 AM,Campus,SOAR Fair,FAU Library,Library,Notes,,,https://x.com,"),
      { defaultCity: "Boca Raton", submittedBy: "test" },
    );
    expect(rows[0]!.universityHint).toBeNull();
  });
});

describe("parseEventsCsv — Campus Labs Engage export", () => {
  const ENGAGE_HEADER = "school,platform,name,organization,starts_on,ends_on,location,description,url,image_url";

  function engageCsv(...rows: string[]): string {
    return [ENGAGE_HEADER, ...rows].join("\n");
  }

  it("detects the starts_on/ends_on shape and converts UTC instants to local date/time", () => {
    const { rows, errors } = parseEventsCsv(
      engageCsv(
        'FAU,campus_labs_engage,FAU Dance Practice,FAU Spirit,2026-08-31T13:00:00+00:00,2026-08-31T16:00:00+00:00,"mac gym ",This will be our practice time,https://fau.campuslabs.com/engage/event/12600834,',
      ),
      { defaultCity: "Boca Raton", submittedBy: "test", timezone: "America/New_York" },
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    const { input } = rows[0]!;
    expect(input.name).toBe("FAU Dance Practice");
    // Aug 31 2026 is EDT (UTC-4): 13:00Z -> 9:00 AM local, 16:00Z -> 12:00 PM local
    expect(input.date).toBe("2026-08-31");
    expect(input.startTime).toBe("09:00");
    expect(input.endTime).toBe("12:00");
    expect(input.venue).toBe("mac gym");
    expect(input.organization).toBe("FAU Spirit");
    expect(input.sourceUrl).toBe("https://fau.campuslabs.com/engage/event/12600834");
  });

  it("carries the school column as universityHint, same as the spreadsheet format's University column", () => {
    const { rows } = parseEventsCsv(
      engageCsv(
        "USF,campus_labs_engage,Splatoon Club Meeting,USF Splatoon,2026-09-01T20:00:00+00:00,,Gaming Lounge,Weekly meetup,https://x.com,",
      ),
      { defaultCity: "Boca Raton", submittedBy: "test", timezone: "America/New_York" },
    );
    expect(rows[0]!.universityHint).toBe("USF");
  });

  it("drops the end time (but keeps the start) when the event spans multiple local calendar days", () => {
    const { rows } = parseEventsCsv(
      engageCsv(
        "FAU,campus_labs_engage,Poster Sale,Owls Racing,2026-08-31T14:00:00+00:00,2026-09-04T21:00:00+00:00,Arena Patio,Fundraiser,https://x.com,",
      ),
      { defaultCity: "Boca Raton", submittedBy: "test", timezone: "America/New_York" },
    );
    expect(rows[0]!.input.date).toBe("2026-08-31");
    expect(rows[0]!.input.startTime).toBe("10:00");
    expect(rows[0]!.input.endTime).toBeNull();
  });

  it("reports a row-level error for an unparseable starts_on instead of throwing", () => {
    const { rows, errors } = parseEventsCsv(engageCsv("FAU,campus_labs_engage,Some Event,,not-a-date,,,,https://x.com,"), {
      defaultCity: "Boca Raton",
      submittedBy: "test",
      timezone: "America/New_York",
    });
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.reason).toContain("starts_on");
  });

  it("defaults the timezone to America/New_York when the caller doesn't pass one", () => {
    const { rows } = parseEventsCsv(
      engageCsv("FAU,campus_labs_engage,FAU Dance Practice,FAU Spirit,2026-08-31T13:00:00+00:00,,mac gym,Practice,https://x.com,"),
      { defaultCity: "Boca Raton", submittedBy: "test" },
    );
    expect(rows[0]!.input.startTime).toBe("09:00");
  });

  it("does not get misdetected as the posh.vip format, and vice versa", () => {
    // Guards the header-sniffing regexes against a false match — "starts_on"
    // must never trip the posh.vip "start_date" check or vice versa.
    const { rows: engageRows } = parseEventsCsv(
      engageCsv("FAU,campus_labs_engage,Some Event,,2026-08-31T13:00:00+00:00,,,,https://x.com,"),
      { defaultCity: "Boca Raton", submittedBy: "test", timezone: "America/New_York" },
    );
    expect(engageRows[0]!.input.startTime).toBe("09:00");

    const poshCsv = [
      "scraped_at,school,name,start_date,end_date,venue,address,organizer,description,image_url,event_url",
      "2026-08-30T00:00:00Z,FAU,Some Club Night,2026-08-31T22:00:00-04:00,,Culture Room,,,,,https://x.com",
    ].join("\n");
    const { rows: poshRows } = parseEventsCsv(poshCsv, { defaultCity: "Boca Raton", submittedBy: "test" });
    expect(poshRows[0]!.input.startTime).toBe("22:00");
  });
});
