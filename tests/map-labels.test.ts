import { describe, it, expect } from "vitest";
import { LINE_DEFS, STATIONS } from "@/lib/network/build";
import { LABEL_PLACEMENT, RENDERED_STATIONS, STATION_XY } from "@/lib/map/geometry";

// Estimated text box for a label. Overpass at these sizes averages a little
// over half the font size per character; 0.55 is deliberately generous so the
// test errs toward catching collisions rather than missing them.
function box(id: string) {
  const s = STATIONS.get(id)!;
  const p = LABEL_PLACEMENT[id];
  const xy = STATION_XY[id];
  const size = s.interchange ? 15 : 13;
  const w = s.name.length * size * 0.55;
  const h = size * 1.2;
  const x = xy[0] + p.dx;
  const y = xy[1] + p.dy;
  const left = p.anchor === "start" ? x : p.anchor === "end" ? x - w : x - w / 2;
  const top = y - h / 2;
  return { left, top, right: left + w, bottom: top + h, id };
}

function overlaps(a: ReturnType<typeof box>, b: ReturnType<typeof box>) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe("always-shown labels", () => {
  // Interchanges and termini are labelled at every zoom, so they are the set
  // that must stay legible without the user zooming in.
  const alwaysShown = [...RENDERED_STATIONS].filter((id) => {
    const s = STATIONS.get(id)!;
    if (s.interchange) return true;
    return s.lines.some((l) => {
      const line = LINE_DEFS.find((d) => d.id === l)!;
      return line.stations[0] === id || line.stations[line.stations.length - 1] === id;
    });
  });

  it("labels a sensible number of stations at default zoom", () => {
    expect(alwaysShown.length).toBeGreaterThan(10);
    expect(alwaysShown.length).toBeLessThan(90);
  });

  it("does not overlap any two of them", () => {
    const boxes = alwaysShown.map(box);
    const clashes: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (overlaps(boxes[i], boxes[j])) clashes.push(`${boxes[i].id} / ${boxes[j].id}`);
      }
    }
    expect(clashes).toEqual([]);
  });
});
