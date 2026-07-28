import { describe, it, expect } from "vitest";
import { EDGES } from "@/lib/network/build";
import { MAP_W, MAP_H, EDGE_PATH, ORPHAN_STATIONS, SNAP_DISTANCE } from "@/lib/map/geometry";

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

  it("never has to drag a polyline far to reach its station", () => {
    // The build snaps each polyline's ends onto its station, so asserting on
    // the *output* endpoints would be vacuously true. Assert on how far the
    // snap had to reach: a short reach is the parallel-lane tick the poster
    // itself draws; a long one means the polyline was routed somewhere else
    // entirely and the snap papered over it with a straight teleport.
    const bad = Object.entries(SNAP_DISTANCE)
      .filter(([, d]) => d > 25)
      .map(([id, d]) => `${id} (${d.toFixed(0)}px)`);
    expect(bad).toEqual([]);
  });

  it("records a snap distance for every edge", () => {
    for (const e of EDGES) {
      expect(SNAP_DISTANCE[e.id], `no snap distance for ${e.id}`).toBeTypeOf("number");
    }
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
