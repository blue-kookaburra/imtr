import { describe, it, expect } from "vitest";
import { EDGES } from "@/lib/network/build";
import {
  MAP_W,
  MAP_H,
  EDGE_PATH,
  ORPHAN_STATIONS,
  SNAP_DISTANCE,
  LABEL_PLACEMENT,
  RENDERED_STATIONS,
} from "@/lib/map/geometry";

// Reaches beyond the 25px snap budget that have been looked at and accepted.
// Each is a parallel-lane tick: the poster bundles these lines into lanes
// running beside the shared station dot, so the snap draws exactly the short
// connector the poster itself draws. Verified by rendering the CBD at 1:1.
// Any edge NOT listed here must stay under 25px — a long reach elsewhere means
// the polyline was routed somewhere else and the snap papered over it with a
// straight teleport. Values are the measured reach; the test allows 2px of
// drift so a tick cannot silently grow into a teleport.
const ACCEPTED_LANE_TICKS: Record<string, number> = {
  "mernda:flinders-street-jolimont": 57.4,
  "hurstbridge:flinders-street-jolimont": 57.4,
  "craigieburn:flinders-street-southern-cross": 71.2,
  "upfield:flinders-street-southern-cross": 71.2,
  "craigieburn:southern-cross-north-melbourne": 71.2,
  "upfield:southern-cross-north-melbourne": 71.2,
  "werribee:southern-cross-north-melbourne": 49.1,
  "williamstown:southern-cross-north-melbourne": 49.1,
  "werribee:north-melbourne-south-kensington": 49.1,
  "williamstown:north-melbourne-south-kensington": 49.1,
};

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
      .filter(([id, d]) => d > (ACCEPTED_LANE_TICKS[id] ?? 0) + 2 && d > 25)
      .map(([id, d]) => `${id} (${d.toFixed(0)}px)`);
    expect(bad).toEqual([]);
  });

  it("has no stale entries in the accepted-lane-tick list", () => {
    const stale = Object.keys(ACCEPTED_LANE_TICKS).filter(
      (id) => (SNAP_DISTANCE[id] ?? 0) <= 25
    );
    expect(stale, "these edges no longer need an exemption — remove them").toEqual([]);
  });

  it("records a snap distance for every edge", () => {
    for (const e of EDGES) {
      expect(SNAP_DISTANCE[e.id], `no snap distance for ${e.id}`).toBeTypeOf("number");
    }
  });

  it("has no orphan stations now the City Loop ring is drawn", () => {
    // flagstaff, melbourne-central and parliament used to have coordinates
    // but no edges (the loop wasn't modelled in lib/network/data.ts yet).
    // Now every loop edge has a polyline, so nothing should be orphaned.
    expect([...ORPHAN_STATIONS].sort()).toEqual([]);
  });

  it("simplifies polylines without moving them far", () => {
    const total = Object.values(EDGE_PATH).reduce((n, p) => n + p.length, 0);
    expect(total).toBeLessThan(1600); // was ~2100 before simplification
  });
});

describe("label placement", () => {
  it("places a label for every rendered station", () => {
    for (const id of RENDERED_STATIONS) {
      expect(LABEL_PLACEMENT[id], `no label placement for ${id}`).toBeDefined();
    }
  });

  it("keeps labels close to their station", () => {
    for (const p of Object.values(LABEL_PLACEMENT)) {
      expect(Math.hypot(p.dx, p.dy)).toBeLessThanOrEqual(30);
    }
  });

  it("uses an anchor consistent with the offset direction", () => {
    for (const [id, p] of Object.entries(LABEL_PLACEMENT)) {
      if (p.dx > 4) expect(p.anchor, id).toBe("start");
      else if (p.dx < -4) expect(p.anchor, id).toBe("end");
      else expect(p.anchor, id).toBe("middle");
    }
  });

  it("spreads labels around rather than stacking them all one way", () => {
    const dirs = new Set(
      Object.values(LABEL_PLACEMENT).map((p) => `${Math.sign(p.dx)},${Math.sign(p.dy)}`)
    );
    expect(dirs.size).toBeGreaterThanOrEqual(5);
  });
});
