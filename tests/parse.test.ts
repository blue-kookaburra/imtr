import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractTableHtml, parsePage, tableRows } from "@/lib/scrape/parse";
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
    expect(ds[0].stations).toContain("flinders-street"); // Parliament aliased to city
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
