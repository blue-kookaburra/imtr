import { describe, it, expect } from "vitest";
import { computeStatus } from "@/lib/status";
import { supersedes } from "@/lib/supersede";
import { melbourneInputToDate, melbourneNowInput } from "@/lib/meltz";
import type { Disruption } from "@/lib/types";

function disruption(over: Partial<Disruption>): Disruption {
  return {
    id: "d1",
    lineIds: ["frankston"],
    wholeLine: true,
    parsed: true,
    startDate: "2026-08-03",
    endDate: "2026-08-05",
    rawText: "Buses replace trains",
    source: "planned-works",
    ...over,
  };
}

const UPDATED = "2026-08-02T00:00:00Z";
const statusOf = (d: Disruption, iso: string) =>
  computeStatus([d], new Date(iso), UPDATED).segments.find((s) => s.edgeId.startsWith("frankston:"))!.status;

describe("overnight daily window (9:30pm to 4am)", () => {
  const d = disruption({ startMin: 21 * 60 + 30, endMin: 4 * 60 });

  it("is active late evening on a works night", () => {
    expect(statusOf(d, "2026-08-04T12:00:00Z")).toBe("bus-replacement"); // Tue 22:00 AEST
  });
  it("is active after midnight on the morning after a works night", () => {
    expect(statusOf(d, "2026-08-04T14:30:00Z")).toBe("bus-replacement"); // Wed 00:30 AEST
  });
  it("is not active in the daytime between nights", () => {
    expect(statusOf(d, "2026-08-04T02:00:00Z")).toBe("running"); // Tue 12:00 AEST
  });
  it("runs through the small hours after the final works night, then stops", () => {
    expect(statusOf(d, "2026-08-05T14:30:00Z")).toBe("bus-replacement"); // Thu 00:30 AEST
    expect(statusOf(d, "2026-08-06T14:30:00Z")).toBe("running"); // Fri 00:30 AEST
  });
});

describe("supersedes", () => {
  const row = disruption({ stations: ["richmond", "caulfield"] });
  it("replaces a row covering the same section", () => {
    expect(supersedes(disruption({ stations: ["richmond", "malvern"] }), row)).toBe(true);
  });
  it("keeps a row for a different section of the same line", () => {
    expect(supersedes(disruption({ stations: ["frankston", "seaford"] }), row)).toBe(false);
  });
  it("keeps a row on non-overlapping dates", () => {
    expect(supersedes(disruption({ startDate: "2026-09-01", endDate: "2026-09-02" }), row)).toBe(false);
  });
});

describe("Melbourne picker time", () => {
  it("reads a datetime-local value as Melbourne wall clock", () => {
    expect(melbourneInputToDate("2026-08-05T12:00").toISOString()).toBe("2026-08-05T02:00:00.000Z"); // AEST
    expect(melbourneInputToDate("2026-01-05T12:00").toISOString()).toBe("2026-01-05T01:00:00.000Z"); // AEDT
  });
  it("formats now as Melbourne wall clock", () => {
    expect(melbourneNowInput(new Date("2026-08-05T14:30:00Z"))).toBe("2026-08-06T00:30");
  });
});
