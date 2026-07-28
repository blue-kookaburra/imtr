import { describe, it, expect } from "vitest";
import { EDGES } from "@/lib/network/build";
import { MAP_W, MAP_H, STATION_XY, EDGE_PATH, ORPHAN_STATIONS } from "@/lib/map/geometry";

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("map geometry", () => {
  it("uses the extracted map's pixel space", () => {
    expect(MAP_W).toBe(3572);
    expect(MAP_H).toBe(2526);
  });

  it("has a polyline for every edge in the network model", () => {
    for (const e of EDGES) {
      expect(EDGE_PATH[e.id], `missing polyline for ${e.id}`).toBeDefined();
      expect(EDGE_PATH[e.id].length).toBeGreaterThanOrEqual(2);
    }
  });

  it("lands every polyline endpoint on its station", () => {
    const bad: string[] = [];
    for (const e of EDGES) {
      const pts = EDGE_PATH[e.id];
      const A = STATION_XY[e.from];
      const B = STATION_XY[e.to];
      const fwd = dist(pts[0], A) + dist(pts[pts.length - 1], B);
      const rev = dist(pts[0], B) + dist(pts[pts.length - 1], A);
      const [d0, d1] =
        fwd <= rev
          ? [dist(pts[0], A), dist(pts[pts.length - 1], B)]
          : [dist(pts[0], B), dist(pts[pts.length - 1], A)];
      if (d0 > 25 || d1 > 25) bad.push(`${e.id} (${d0.toFixed(0)}, ${d1.toFixed(0)})`);
    }
    expect(bad).toEqual([]);
  });

  it("pins the known orphan stations", () => {
    // The City Loop is not modelled in lib/network/data.ts, so these three
    // have coordinates but no edges and are deliberately not rendered.
    expect([...ORPHAN_STATIONS].sort()).toEqual(["flagstaff", "melbourne-central", "parliament"]);
  });

  it("simplifies polylines without moving them far", () => {
    const total = Object.values(EDGE_PATH).reduce((n, p) => n + p.length, 0);
    expect(total).toBeLessThan(1600); // was ~2100 before simplification
  });
});
