import { describe, it, expect } from "vitest";
import { computeStatus } from "@/lib/status";
import type { Disruption } from "@/lib/types";

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

  it("emits a status for every rendered station and no orphans", () => {
    const res = computeStatus([], AT, UPDATED);
    const ids = new Set(res.stations.map((s) => s.stationId));
    expect(ids.has("flagstaff")).toBe(false);
    expect(ids.has("richmond")).toBe(true);
  });
});
