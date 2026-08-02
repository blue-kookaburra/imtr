import { describe, it, expect } from "vitest";
import { computeStationStatuses } from "@/lib/status";
import { toMelTime } from "@/lib/spans";
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
