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

  it("does not let 'concert' in the Notes reclassify a nightlife event as campus", () => {
    // Regression: resolveCategory's "prefer a stronger Notes signal" override
    // used to trust *any* non-"other" guess once "concert" appeared anywhere
    // in the Notes text. categorizeEvent ranks "campus" ahead of "concert",
    // so Notes mentioning both ("Live DJ concert at the Student Union") took
    // the campus guess instead -- silently moving a nightlife event into
    // Monday's post instead of Thursday's.
    const { rows } = parseEventsCsv(
      csv(
        '2026-08-27,Thu,9:00 PM,Nightlife,Homecoming Bash,Culture Room,"Culture Room, Fort Lauderdale","Live DJ concert at the Student Union",,,https://www.cultureroom.net/',
      ),
      { defaultCity: "Boca Raton", submittedBy: "test" },
    );
    expect(rows[0]!.input.category).toBe("nightlife");
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
