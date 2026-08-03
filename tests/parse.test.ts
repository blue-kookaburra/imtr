import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  extractArticleUrls,
  extractTableHtml,
  parseArticle,
  parsePage,
  tableRows,
  sectionStations,
  loopSkippedStations,
} from "@/lib/scrape/parse";
import { computeStatus, computeCalendar } from "@/lib/status";
import { EDGES, STATIONS, edgesBetween } from "@/lib/network/build";

const FIXTURE = readFileSync(join(__dirname, "fixtures", "werribee.html"), "utf-8");
// The fixture was scraped on this date; anchors year inference.
const REF = new Date("2026-07-25T00:00:00Z");

describe("network topology", () => {
  it("builds all stations with coordinates", () => {
    expect(STATIONS.size).toBeGreaterThan(200);
    for (const s of STATIONS.values()) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
    }
  });

  it("maps a section onto edges", () => {
    const edges = edgesBetween("werribee", "newport", "werribee");
    expect(edges.length).toBe(8); // newport..werribee via Altona loop
    expect(EDGES.some((e) => e.id === "werribee:newport-seaholme")).toBe(true);
  });
});

describe("planned-works parser", () => {
  it("extracts tables from __NEXT_DATA__", () => {
    const tables = extractTableHtml(FIXTURE);
    expect(tables.length).toBeGreaterThan(0);
    expect(tableRows(tables[0]).join(" ")).toContain("Werribee");
  });

  it("parses the Newport-Werribee bus replacement", () => {
    const ds = parsePage(FIXTURE, REF);
    expect(ds.length).toBeGreaterThan(0);
    const d = ds.find((x) => x.fromStation === "newport" && x.toStation === "werribee");
    expect(d).toBeDefined();
    expect(d!.lineIds).toContain("werribee");
    expect(d!.startDate).toBe("2026-07-13");
    expect(d!.endDate).toBe("2026-07-16");
    expect(d!.parsed).toBe(true);
  });

  it("parses the multi-station 'between North Melbourne, Newport and Williamstown' row", () => {
    const ds = parsePage(FIXTURE, REF);
    const d = ds.find((x) => x.toStation === "williamstown");
    expect(d).toBeDefined();
    expect(d!.fromStation).toBe("north-melbourne");
    expect(d!.startDate).toBe("2026-07-25");
    expect(d!.endDate).toBe("2026-07-26");
  });
});

describe("parser row formats", () => {
  // Wrap a row in the minimal table + __NEXT_DATA__ shell the parser expects.
  function page(row: string): string {
    const table = `<table><tr><td>${row}</td></tr></table>`;
    const data = { props: { Text: { value: table } } };
    return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
  }

  it("matches lines from 'X, Y and Z passengers' phrasing", () => {
    const ds = parsePage(
      page(
        "Alamein, Belgrave and Lilydale passengers Sunday 19 July to Wednesday 22 July Buses replace evening trains between Parliament, Alamein and Box Hill."
      ),
      REF
    );
    expect(ds).toHaveLength(1);
    expect(ds[0].lineIds.sort()).toEqual(["alamein", "belgrave", "lilydale"]);
    expect(ds[0].stations).toContain("parliament"); // Parliament is a City Loop station
    expect(ds[0].stations).toContain("box-hill");
    expect(ds[0].startMin).toBe(18 * 60); // "evening trains"
  });

  it("treats sectionless 'Buses replace trains.' as whole-line, parsed", () => {
    const ds = parsePage(
      page("Sandringham passengers Friday 24 July to Sunday 26 July Buses replace trains."),
      REF
    );
    expect(ds).toHaveLength(1);
    expect(ds[0].wholeLine).toBe(true);
    expect(ds[0].parsed).toBe(true);
  });

  it("spans multi-branch sections per line", () => {
    const ds = parsePage(
      page(
        "Alamein, Belgrave and Lilydale passengers Sunday 19 July to Wednesday 22 July Buses replace evening trains between Parliament, Alamein and Box Hill."
      ),
      REF
    );
    const status = computeStatus(ds, new Date("2026-07-20T10:00:00Z"), REF.toISOString());
    // 8pm Melbourne on the 20th — evening window active
    const alameinBranch = status.segments.find((s) => s.edgeId === "alamein:ashburton-alamein");
    expect(alameinBranch!.status).toBe("bus-replacement");
    const belgraveCity = status.segments.find((s) => s.edgeId === "belgrave:richmond-east-richmond");
    expect(belgraveCity!.status).toBe("bus-replacement");
    // Beyond Box Hill on Belgrave line: unaffected
    const beyond = status.segments.find((s) => s.edgeId === "belgrave:ringwood-heathmont");
    expect(beyond!.status).toBe("running");
  });
});

describe("article parsing", () => {
  const ARTICLE = readFileSync(join(__dirname, "fixtures", "article-werribee.html"), "utf-8");
  const URL = "https://transport.vic.gov.au/disruptions/disruptions-information/article/test";

  it("extracts exact timestamps from the article page", () => {
    const d = parseArticle(ARTICLE, URL)!;
    expect(d).not.toBeNull();
    expect(d.lineIds.sort()).toEqual(["werribee", "williamstown"]);
    // FromDate 2026-07-25 21:00 Melbourne = 11:00 UTC (AEST)
    expect(d.startTs).toBe("2026-07-25T11:00:00.000Z");
    expect(d.endTs).toBe("2026-07-26T17:00:00.000Z");
    expect(d.startDate).toBe("2026-07-25");
    expect(d.endDate).toBe("2026-07-27");
    expect(d.stations).toContain("north-melbourne");
    expect(d.stations).toContain("williamstown");
    expect(d.url).toBe(URL);
  });

  it("trains still running before the start timestamp", () => {
    const d = parseArticle(ARTICLE, URL)!;
    // Sat 25 July, 8:00pm Melbourne = 10:00 UTC — before the 9pm start
    const before = computeStatus([d], new Date("2026-07-25T10:00:00Z"), "2026-07-25T00:00:00Z");
    const seg = before.segments.find((s) => s.edgeId === "williamstown:newport-north-williamstown");
    expect(seg!.status).toBe("running");
    // Sat 25 July, 10:00pm Melbourne = 12:00 UTC — after start
    const after = computeStatus([d], new Date("2026-07-25T12:00:00Z"), "2026-07-25T00:00:00Z");
    const seg2 = after.segments.find((s) => s.edgeId === "williamstown:newport-north-williamstown");
    expect(seg2!.status).toBe("bus-replacement");
  });

  it("calendar shows partial on the start day, disrupted on the full day", () => {
    const d = parseArticle(ARTICLE, URL)!;
    const days = computeCalendar("williamstown", [d], "2026-07-25", "2026-07-27", "2026-07-25T00:00:00Z", "2026-08-22");
    const byDate = Object.fromEntries(days.map((x) => [x.date, x]));
    expect(byDate["2026-07-25"].status).toBe("partial");
    expect(byDate["2026-07-25"].summary).toContain("Trains run until 9:00pm");
    expect(byDate["2026-07-26"].status).toBe("disrupted");
    expect(byDate["2026-07-27"].status).toBe("partial");
  });

  it("finds article links on line pages", () => {
    const urls = extractArticleUrls(FIXTURE);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0]).toContain("/disruptions/disruptions-information/article/");
  });
});

describe("status merge", () => {
  const ds = parsePage(FIXTURE, REF);

  it("blacks out Newport-Werribee during the disruption", () => {
    const status = computeStatus(ds, new Date("2026-07-14T02:00:00Z"), REF.toISOString());
    // 2026-07-14 12:00 Melbourne time — disruption active
    const seg = status.segments.find((s) => s.edgeId === "werribee:newport-seaholme");
    expect(seg!.status).toBe("bus-replacement");
    const citySeg = status.segments.find((s) => s.edgeId === "werribee:footscray-seddon");
    expect(citySeg!.status).toBe("running");
  });

  it("shows no-service at 4am Thursday", () => {
    // 2026-07-16 is a Thursday; 4am Melbourne = 18:00 UTC on the 15th.
    const status = computeStatus([], new Date("2026-07-15T18:00:00Z"), REF.toISOString());
    const seg = status.segments.find((s) => s.edgeId === "werribee:footscray-seddon");
    expect(seg!.status).toBe("no-service");
  });

  it("runs during Friday Night Network smallhours", () => {
    // Saturday 3am Melbourne = Friday 17:00 UTC.
    const status = computeStatus([], new Date("2026-07-17T17:00:00Z"), REF.toISOString());
    const seg = status.segments.find((s) => s.edgeId === "werribee:footscray-seddon");
    expect(seg!.status).toBe("running");
  });
});

describe("calendar", () => {
  const ds = parsePage(FIXTURE, REF);

  it("marks disrupted days at an affected station", () => {
    const days = computeCalendar("hoppers-crossing", ds, "2026-07-12", "2026-07-18", REF.toISOString(), "2026-08-22");
    const byDate = Object.fromEntries(days.map((d) => [d.date, d.status]));
    expect(byDate["2026-07-12"]).toBe("normal");
    expect(byDate["2026-07-14"]).toBe("disrupted");
    expect(byDate["2026-07-17"]).toBe("normal");
  });

  it("station outside the section stays normal", () => {
    const days = computeCalendar("yarraville", ds, "2026-07-13", "2026-07-16", REF.toISOString(), "2026-08-22");
    expect(days.every((d) => d.status === "normal")).toBe(true);
  });

  it("beyond horizon shows no-data", () => {
    const days = computeCalendar("yarraville", ds, "2026-09-01", "2026-09-03", REF.toISOString(), "2026-08-22");
    expect(days.every((d) => d.status === "no-data")).toBe(true);
  });
});

describe("City Loop station names", () => {
  it("resolves loop stations as themselves, not as Flinders Street", () => {
    const ids = sectionStations(
      "Buses replace evening trains between Parliament, Alamein and Box Hill."
    );
    expect(ids).toContain("parliament");
    expect(ids).not.toContain("flinders-street");
  });

  it("resolves Melbourne Central and Flagstaff", () => {
    const ids = sectionStations("Buses replace trains between Flagstaff and Melbourne Central.");
    expect(ids?.slice().sort()).toEqual(["flagstaff", "melbourne-central"]);
  });
});

describe("loop closures", () => {
  // A loop closure is "these three stations are skipped", never a section
  // spanning min..max of some indices — sectionStations stays section-only.
  it("does not read a loop phrase as an explicit section", () => {
    const ids = sectionStations(
      "Trains run direct to Flinders Street and will not run via the City Loop."
    );
    expect(ids).toBeNull();
  });

  it("reads 'run direct to Flinders Street' as the ring being out", () => {
    const skipped = loopSkippedStations(
      "Trains run direct to Flinders Street and will not run via the City Loop."
    );
    expect(skipped?.slice().sort()).toEqual(["flagstaff", "melbourne-central", "parliament"].sort());
  });

  it("recognizes 'City Loop is closed' and 'not run through the City Loop'", () => {
    expect(loopSkippedStations("The City Loop is closed for maintenance.")).not.toBeNull();
    expect(loopSkippedStations("Trains will not run through the City Loop.")).not.toBeNull();
  });

  it("reads an explicit skip list naming all three ring stations", () => {
    const skipped = loopSkippedStations(
      "Trains will not stop at Flagstaff, Melbourne Central and Parliament."
    );
    expect(skipped).toContain("flagstaff");
    expect(skipped).toContain("parliament");
  });

  it("does not treat one named station as a ring closure", () => {
    // A single station being skipped is not "the ring is shut" — could be any
    // unrelated reason.
    expect(loopSkippedStations("Trains will not stop at Flagstaff this weekend.")).toBeNull();
  });

  it("does not fire on a whole-line bus replacement phrased the same way", () => {
    // The subject must be TRAINS. "Buses run direct to Flinders Street" is a
    // whole-line bus replacement; reading it as a loop closure would leave
    // wholeLine untouched and report the (bus-replaced) trunk as normal — a
    // false all-clear.
    expect(loopSkippedStations("Buses run direct to Flinders Street Station.")).toBeNull();
  });

  it("keeps sectionStations reporting only the named section when both signals are present", () => {
    // Both signals present: sectionStations reports only the explicit
    // section; loopSkippedStations independently picks up the loop mention.
    const ids = sectionStations(
      "Buses replace trains between Ringwood and Belgrave. Other trains run direct to Flinders Street."
    );
    expect(ids?.slice().sort()).toEqual(["belgrave", "ringwood"].sort());
  });

  it("does not fire on ordinary city-bound wording", () => {
    // "to Flinders Street" alone is how half of all disruption text ends, and
    // this one is already a well-formed section.
    const text = "Buses replace trains from Ringwood to Flinders Street.";
    const ids = sectionStations(text);
    expect(ids).not.toContain("flagstaff");
    expect(ids?.slice().sort()).toEqual(["flinders-street", "ringwood"].sort());
    expect(loopSkippedStations(text)).toBeNull();
  });

  it("still declines to guess on text with no section and no loop phrase", () => {
    expect(sectionStations("Major works affecting services. Check before you travel.")).toBeNull();
    expect(sectionStations("Trains may be delayed up to 20 minutes.")).toBeNull();
    expect(loopSkippedStations("Major works affecting services. Check before you travel.")).toBeNull();
    expect(loopSkippedStations("Trains may be delayed up to 20 minutes.")).toBeNull();
  });
});
