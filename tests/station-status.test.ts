import { describe, it, expect } from "vitest";
import { computeStatus } from "@/lib/status";
import { STATIONS } from "@/lib/network/build";
import type { Disruption, StationStatusKind } from "@/lib/types";

// A Wednesday midday in Melbourne — every line is inside timetabled hours,
// so nothing is no-service and disruptions are free to show.
const AT = new Date("2026-08-05T02:00:00Z"); // 12:00 Melbourne (AEST, UTC+10)
const UPDATED = "2026-08-04T00:00:00Z";

function disruption(over: Partial<Disruption>): Disruption {
  return {
    id: "d1",
    lineIds: ["frankston"],
    wholeLine: false,
    parsed: true,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    rawText: "Buses replace trains",
    source: "planned-works",
    ...over,
  };
}

function stationStatus(res: ReturnType<typeof computeStatus>, id: string) {
  return res.stations.find((s) => s.stationId === id);
}

describe("per-station status", () => {
  it("marks stations inside the section as cut", () => {
    const res = computeStatus(
      [disruption({ stations: ["richmond", "caulfield"], fromStation: "richmond", toStation: "caulfield" })],
      AT,
      UPDATED
    );
    expect(stationStatus(res, "south-yarra")!.status).toBe("cut");
    expect(stationStatus(res, "malvern")!.status).toBe("cut");
  });

  it("marks the ends of the section as boundary, not cut", () => {
    const res = computeStatus(
      [disruption({ stations: ["richmond", "caulfield"], fromStation: "richmond", toStation: "caulfield" })],
      AT,
      UPDATED
    );
    // Trains still reach both ends from the far side.
    expect(stationStatus(res, "richmond")!.status).toBe("boundary");
    expect(stationStatus(res, "caulfield")!.status).toBe("boundary");
  });

  it("leaves stations outside the section normal", () => {
    const res = computeStatus(
      [disruption({ stations: ["richmond", "caulfield"], fromStation: "richmond", toStation: "caulfield" })],
      AT,
      UPDATED
    );
    expect(stationStatus(res, "frankston")!.status).toBe("normal");
  });

  it("reports per-line detail at an interchange", () => {
    const res = computeStatus(
      [disruption({ stations: ["south-yarra", "caulfield"], fromStation: "south-yarra", toStation: "caulfield" })],
      AT,
      UPDATED
    );
    const richmond = stationStatus(res, "richmond")!;
    // Richmond is served by many lines; only Frankston is touched here, and
    // Richmond sits outside that section, so overall it stays normal.
    expect(richmond.status).toBe("normal");
    const frankstonEntry = richmond.lines.find((l) => l.lineId === "frankston");
    expect(frankstonEntry!.status).toBe("normal");
  });

  it("marks every station on a line as warning when the section is unparseable", () => {
    const res = computeStatus(
      [disruption({ parsed: false, wholeLine: false, stations: undefined })],
      AT,
      UPDATED
    );
    expect(stationStatus(res, "frankston")!.status).toBe("warning");
    expect(stationStatus(res, "bentleigh")!.status).toBe("warning");
    // A line with no disruption is untouched.
    expect(stationStatus(res, "belgrave")!.status).toBe("normal");
  });

  it("lets cut outrank warning at the same station", () => {
    const res = computeStatus(
      [
        disruption({ id: "d1", parsed: false, wholeLine: false, stations: undefined }),
        disruption({
          id: "d2",
          lineIds: ["sandringham"],
          stations: ["richmond", "brighton-beach"],
          fromStation: "richmond",
          toStation: "brighton-beach",
        }),
      ],
      AT,
      UPDATED
    );
    // South Yarra is on both lines: warning on Frankston (unparseable) and cut
    // on Sandringham (inside richmond..brighton-beach). The stronger wins.
    const sy = stationStatus(res, "south-yarra")!;
    expect(sy.status).toBe("cut");
    expect(sy.lines.find((l) => l.lineId === "frankston")!.status).toBe("warning");
    expect(sy.lines.find((l) => l.lineId === "sandringham")!.status).toBe("cut");
  });

  it("cuts a section end that is also the line terminus", () => {
    // Buses between Ringwood and Belgrave. Belgrave is the end of the line, so
    // there is no far side for a train to arrive from — every service to it is
    // replaced. Calling that "trains terminate here" would be a false all-clear.
    const res = computeStatus(
      [
        disruption({
          lineIds: ["belgrave"],
          stations: ["ringwood", "belgrave"],
          fromStation: "ringwood",
          toStation: "belgrave",
        }),
      ],
      AT,
      UPDATED
    );
    expect(stationStatus(res, "belgrave")!.status).toBe("cut");
    // Ringwood does have a far side, so it really is a terminating point.
    expect(stationStatus(res, "ringwood")!.status).toBe("boundary");
  });

  it("keeps an unmapped disruption visible even when a confident state outranks it", () => {
    const res = computeStatus(
      [
        disruption({ id: "d1", parsed: false, wholeLine: false, stations: undefined }),
        disruption({
          id: "d2",
          stations: ["caulfield", "carrum"],
          fromStation: "caulfield",
          toStation: "carrum",
        }),
      ],
      AT,
      UPDATED
    );
    const carrum = stationStatus(res, "carrum")!;
    expect(carrum.status).toBe("boundary");
    // The parser failed to understand something else on this line. That must
    // survive alongside the confident state, not be masked by it.
    expect(carrum.unmapped).toBe(true);
    expect(carrum.lines.find((l) => l.lineId === "frankston")!.unmapped).toBe(true);
  });

  it("reports no-service outside timetabled hours rather than normal", () => {
    // 3am Melbourne on a Wednesday — nothing is timetabled.
    const at3am = new Date("2026-08-04T17:00:00Z");
    const res = computeStatus([], at3am, UPDATED);
    const sy = stationStatus(res, "south-yarra")!;
    expect(sy.status).toBe("no-service");
    expect(sy.lines.every((l) => l.status === "no-service")).toBe(true);
  });

  it("does not let one sleeping line outrank the running ones", () => {
    // Stony Point runs a sparse timetable; whatever the hour, a station's
    // overall status must never be dragged to no-service while other lines run.
    const res = computeStatus([], AT, UPDATED);
    for (const s of res.stations) {
      const running = s.lines.filter((l) => l.status !== "no-service");
      if (running.length > 0) expect(s.status).not.toBe("no-service");
    }
  });

  it("cuts every station when a whole line is replaced", () => {
    const res = computeStatus(
      [disruption({ lineIds: ["alamein"], wholeLine: true, stations: undefined })],
      AT,
      UPDATED
    );
    expect(stationStatus(res, "alamein")!.status).toBe("cut");
    expect(stationStatus(res, "riversdale")!.status).toBe("cut");
  });

  it("keeps the overall status equal to the worst running line", () => {
    const res = computeStatus(
      [disruption({ lineIds: ["alamein"], wholeLine: true, stations: undefined })],
      AT,
      UPDATED
    );
    for (const s of res.stations) {
      const running = s.lines.filter((l) => l.status !== "no-service");
      if (!running.length) continue;
      const rank = { "no-service": -1, normal: 0, warning: 1, boundary: 2, cut: 3 } as const;
      const worst = running.reduce((a, l) => (rank[l.status] > rank[a] ? l.status : a), "normal" as StationStatusKind);
      expect(s.status, s.stationId).toBe(worst);
    }
  });

  it("emits a status for every station in the network model", () => {
    const res = computeStatus([], AT, UPDATED);
    expect(res.stations.length).toBe(STATIONS.size);
    for (const s of res.stations) expect(s.lines.length).toBeGreaterThan(0);
    // The City Loop is not modelled at all, so these never appear.
    const ids = new Set(res.stations.map((s) => s.stationId));
    for (const orphan of ["flagstaff", "melbourne-central", "parliament"]) {
      expect(ids.has(orphan), orphan).toBe(false);
    }
  });
});
