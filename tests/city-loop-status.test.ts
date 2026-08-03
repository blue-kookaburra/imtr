import { describe, it, expect } from "vitest";
import { computeStationStatuses, computeStatus } from "@/lib/status";
import { toMelTime } from "@/lib/spans";
import { parsePage, parseArticle } from "@/lib/scrape/parse";
import { EDGES } from "@/lib/network/build";
import type { Disruption, LineId } from "@/lib/types";

function disruption(over: Partial<Disruption>): Disruption {
  return {
    id: "test-1",
    lineIds: ["belgrave"],
    wholeLine: false,
    parsed: true,
    startDate: "2026-08-05",
    endDate: "2026-08-05",
    rawText: "test",
    source: "planned-works",
    ...over,
  };
}

// Wednesday midday Melbourne — every line is running, so a status here is a
// statement about disruption rather than about the timetable.
const MIDDAY = toMelTime(new Date("2026-08-05T02:00:00Z"));
// 3am Melbourne, when nothing is timetabled.
const NIGHT = toMelTime(new Date("2026-08-04T17:00:00Z"));

function statusAt(stationId: string, active: Disruption[], t = MIDDAY) {
  const warnings = new Map<LineId, Set<string>>();
  return computeStationStatuses(active, t, warnings).find((s) => s.stationId === stationId)!;
}

describe("City Loop status", () => {
  it("cuts loop stations when a section runs through the ring", () => {
    const d = disruption({
      // The real text in data/disruptions.json. It is multi-branch: Alamein is
      // named as a station (that line's terminus) and Box Hill is on
      // Belgrave/Lilydale, so the per-line spans differ — parliament..alamein
      // on one, parliament..box-hill on the other. Box Hill is NOT on the
      // Alamein line, so listing it alone against alamein would span nothing.
      lineIds: ["alamein", "belgrave"],
      stations: ["parliament", "alamein", "box-hill"],
      rawText: "Buses replace evening trains between Parliament, Alamein and Box Hill.",
    });
    const parliament = statusAt("parliament", [d]);
    const alameinLine = parliament.lines.find((l) => l.lineId === "alamein")!;
    // Parliament is the city end of the section and the far side (Flinders
    // Street) is still reachable, so it terminates rather than being cut off.
    expect(alameinLine.status).toBe("boundary");

    const camberwell = statusAt("camberwell", [d]);
    expect(camberwell.lines.find((l) => l.lineId === "alamein")!.status).toBe("cut");
  });

  it("leaves the loop alone for a disruption out on the branch", () => {
    const d = disruption({
      lineIds: ["belgrave"],
      stations: ["ringwood", "belgrave"],
      rawText: "Buses replace trains between Ringwood and Belgrave.",
    });
    const flagstaff = statusAt("flagstaff", [d]);
    expect(flagstaff.lines.find((l) => l.lineId === "belgrave")!.status).toBe("normal");
    expect(flagstaff.status).toBe("normal");
  });

  it("closes the loop while the trunk keeps running", () => {
    // The classic "trains run direct to Flinders Street" shape: the ring is
    // out, the branch is not.
    const d = disruption({
      lineIds: ["belgrave"],
      stations: ["flinders-street", "parliament"],
      rawText: "Trains run direct to Flinders Street and do not stop at Parliament.",
    });
    expect(statusAt("melbourne-central", [d]).lines.find((l) => l.lineId === "belgrave")!.status).toBe("cut");
    expect(statusAt("ringwood", [d]).lines.find((l) => l.lineId === "belgrave")!.status).toBe("normal");
  });

  it("reports loop stations as asleep overnight, not broken", () => {
    for (const id of ["flagstaff", "melbourne-central", "parliament"]) {
      expect(statusAt(id, [], NIGHT).status, id).toBe("no-service");
    }
  });

  it("takes the worst line at a loop station without hiding the others", () => {
    const d = disruption({
      lineIds: ["alamein"],
      stations: ["parliament", "alamein"],
    });
    const parliament = statusAt("parliament", [d]);
    // Nine lines serve Parliament; one is disrupted.
    expect(parliament.lines).toHaveLength(9);
    expect(parliament.status).toBe("boundary");
    expect(parliament.lines.filter((l) => l.status === "normal").length).toBe(8);
  });
});

describe("loop-only disruptions (skipsStations)", () => {
  // "Trains run direct to Flinders Street and will not run via the City
  // Loop" — the ring is out, the trunk keeps running. skipsStations names
  // exactly the three ring stations; there is no explicit section.
  //
  // wholeLine/parsed are spelled out explicitly here (not left to the
  // disruption() helper's defaults) because they must match what the real
  // parser emits for this exact text: `parsePage`/`parseArticle` compute
  // wholeLine as `!stations && !skipsStations`, so a loop closure with no
  // separately-stated section is wholeLine: false, never true. The
  // "loop-only disruptions via the real parser" block below proves that by
  // running the actual parser instead of asserting it here.
  const d = disruption({
    lineIds: ["belgrave"],
    stations: undefined,
    skipsStations: ["flagstaff", "melbourne-central", "parliament"],
    wholeLine: false,
    parsed: true,
    rawText: "Trains run direct to Flinders Street and will not run via the City Loop.",
  });

  it("keeps Flinders Street normal — it is not the section end of a span", () => {
    // Defect 1: Flinders Street is always index 0 in matchSequence, so
    // treating this as a lineSpan would wrongly call it unreachable "from
    // beyond" and report it cut, contradicting the text.
    const flindersSt = statusAt("flinders-street", [d]);
    expect(flindersSt.lines.find((l) => l.lineId === "belgrave")!.status).toBe("normal");
  });

  it("keeps Southern Cross normal on a Burnley-group line during a loop closure", () => {
    // Defect 2: Southern Cross sits inside the ring order for the
    // belgrave/lilydale/alamein/glen-waverley group, but it is on the surface
    // route every train uses, loop or direct, so it must never be swept in.
    const southernCross = statusAt("southern-cross", [d]);
    expect(southernCross.lines.find((l) => l.lineId === "belgrave")!.status).toBe("normal");
  });

  it("cuts all three named ring stations", () => {
    for (const id of ["flagstaff", "melbourne-central", "parliament"]) {
      const st = statusAt(id, [d]);
      expect(st.lines.find((l) => l.lineId === "belgrave")!.status, id).toBe("cut");
    }
  });

  it("leaves a trunk station well out on the line untouched", () => {
    const ringwood = statusAt("ringwood", [d]);
    expect(ringwood.lines.find((l) => l.lineId === "belgrave")!.status).toBe("normal");
    expect(ringwood.status).toBe("normal");
  });
});

// End-to-end: run the real scraper parser on canonical no-explicit-section
// loop-closure text, and feed the *real* Disruption it produces (not a
// hand-built one) into computeStationStatuses/computeStatus. This is the
// coverage that catches drift between what the parser actually emits
// (wholeLine, parsed) and what a hand-built test fixture assumes.
describe("loop-only disruptions via the real parser (end-to-end)", () => {
  const LOOP_ROW =
    "Belgrave Line: The City Loop is closed for maintenance. Trains run direct to Flinders Street. " +
    "Monday 10 August to Wednesday 12 August.";
  const pageHtml = `<script id="__NEXT_DATA__">${JSON.stringify({
    props: { pageProps: { body: { Text: { value: `<table><tr><td>${LOOP_ROW}</td></tr></table>` } } } },
  })}</script>`;

  const disruptions = parsePage(pageHtml, new Date("2026-08-01T00:00:00Z"));
  // Tuesday midday, inside the Aug 10-12 date range, well within timetabled hours.
  const AT = new Date("2026-08-11T02:00:00Z");

  it("parses to skipsStations with wholeLine false and parsed true", () => {
    expect(disruptions).toHaveLength(1);
    const d = disruptions[0];
    expect(d.skipsStations?.slice().sort()).toEqual(
      ["flagstaff", "melbourne-central", "parliament"].sort()
    );
    expect(d.stations).toBeUndefined();
    // The bug this test exists to catch: wholeLine must NOT be true just
    // because there was no separately-stated section.
    expect(d.wholeLine).toBe(false);
    expect(d.parsed).toBe(true);
  });

  it("parseArticle produces the same shape for the same phrasing", () => {
    const articleHtml = `<script id="__NEXT_DATA__">${JSON.stringify({
      props: {
        pageProps: {
          disruption: {
            ID: 4242,
            Title: "Belgrave Line",
            ArticleTitle: "Belgrave Line: City Loop closed for maintenance",
            SubtitleMessage: "The City Loop is closed for maintenance.",
            FromDate: "2026-08-10 21:00:00",
            ToDate: "2026-08-12 05:00:00",
            Article: "<p>The City Loop is closed for maintenance. Trains run direct to Flinders Street.</p>",
            Lines: { "1": { Line: "Belgrave" } },
          },
        },
      },
    })}</script>`;
    const d = parseArticle(articleHtml, "https://example.test/article");
    expect(d).not.toBeNull();
    expect(d!.skipsStations?.slice().sort()).toEqual(
      ["flagstaff", "melbourne-central", "parliament"].sort()
    );
    expect(d!.stations).toBeUndefined();
    expect(d!.wholeLine).toBe(false);
    expect(d!.parsed).toBe(true);
  });

  it("keeps Flinders Street and Southern Cross normal, cuts the ring, leaves the trunk alone", () => {
    const t = toMelTime(AT);
    const res = computeStationStatuses(disruptions, t, new Map());
    const at = (id: string) => res.find((s) => s.stationId === id)!.lines.find((l) => l.lineId === "belgrave")!.status;

    expect(at("flinders-street")).toBe("normal");
    expect(at("southern-cross")).toBe("normal");
    expect(at("flagstaff")).toBe("cut");
    expect(at("melbourne-central")).toBe("cut");
    expect(at("parliament")).toBe("cut");
    expect(at("ringwood")).toBe("normal");
  });

  it("severs only the ring edges on the map, leaving trunk edges running with no line warning", () => {
    const res = computeStatus(disruptions, AT, "2026-08-04T00:00:00Z");
    const segStatus = (id: string) => res.segments.find((s) => s.edgeId === id)!.status;

    // Ring edges touching a skipped station: severed.
    expect(segStatus("belgrave:southern-cross-flagstaff")).toBe("bus-replacement");
    expect(segStatus("belgrave:flagstaff-melbourne-central")).toBe("bus-replacement");
    expect(segStatus("belgrave:melbourne-central-parliament")).toBe("bus-replacement");
    expect(segStatus("belgrave:parliament-richmond")).toBe("bus-replacement");

    // The surface route every train uses (loop or direct) is untouched.
    expect(segStatus("belgrave:flinders-street-southern-cross")).toBe("running");
    // The direct trunk edge (bypassing the loop entirely) is untouched too.
    expect(segStatus("belgrave:flinders-street-richmond")).toBe("running");
    // A station well out on the branch is untouched.
    const ringwoodEdge = EDGES.find((e) => e.lineId === "belgrave" && e.from === "heatherdale" && e.to === "ringwood")!;
    expect(segStatus(ringwoodEdge.id)).toBe("running");

    // Defect this test exists to catch: no false "couldn't parse a section"
    // line warning when skipsStations already gives a precise answer.
    expect(res.lineWarnings.find((w) => w.lineId === "belgrave")).toBeUndefined();
  });
});

// The adversarial strings from the earlier review round, re-checked against
// the real parser end to end to confirm C3/C4 are still closed after this
// round's wholeLine/parsed fix.
describe("adversarial strings stay closed (C3/C4 regression)", () => {
  function rowPage(row: string) {
    return `<script id="__NEXT_DATA__">${JSON.stringify({
      props: { pageProps: { body: { Text: { value: `<table><tr><td>${row}</td></tr></table>` } } } },
    })}</script>`;
  }

  it("C4: a whole-line bus replacement phrased like the loop boilerplate is not read as a loop closure", () => {
    const row =
      "Belgrave Line: Buses replace trains. Buses run direct to Flinders Street Station. " +
      "Monday 10 August to Wednesday 12 August.";
    const disruptions = parsePage(rowPage(row), new Date("2026-08-01T00:00:00Z"));
    expect(disruptions).toHaveLength(1);
    expect(disruptions[0].skipsStations).toBeUndefined();
    expect(disruptions[0].wholeLine).toBe(true);
  });

  it("C3: a single named ring station is not read as a full ring closure", () => {
    const row =
      "Belgrave Line: Buses replace trains. Trains will not stop at Flagstaff this weekend due to maintenance. " +
      "Monday 10 August to Wednesday 12 August.";
    const disruptions = parsePage(rowPage(row), new Date("2026-08-01T00:00:00Z"));
    expect(disruptions).toHaveLength(1);
    expect(disruptions[0].skipsStations).toBeUndefined();
  });
});
