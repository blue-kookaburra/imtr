// Expand the City Loop's per-colour-group ring lanes (printed by
// scripts/trace_loop_ring.py) into per-line, per-edge-id polylines, and merge
// them into data/map-overrides.json.
//
// Run this after a new poster edition moves the five ring stations
// (flinders-street, southern-cross, flagstaff, melbourne-central, parliament)
// and you've re-run trace_loop_ring.py to re-trace the four lane centrelines.
// Chain the two, then rebuild:
//
//   python scripts/trace_loop_ring.py | npx tsx scripts/expand_loop_lanes.ts
//   npm run map:build
//
// Imports LOOP straight from lib/network/data.ts, so the group -> line ->
// edge-id expansion (walking each group's `[flinders-street, ...order,
// portal]` chain) can't drift from how lib/network/build.ts constructs its
// own edge ids.
//
// This only produces the ring segments. Portal edges — the one edge per
// group that joins the ring back onto its own trunk line (e.g.
// belgrave:parliament-richmond) — are still hand-authored straight lines in
// data/map-overrides.json, because trace_loop_ring.py only draws the five
// stations that are actually on the ring; the portal's trunk-side station
// (richmond, jolimont, north-melbourne) isn't one of them. Edges without a
// matching ring lane are reported as still needing that hand routing, not
// silently skipped.
import { readFileSync, writeFileSync } from "fs";
import { LOOP } from "../lib/network/data";

type XY = [number, number];

function readStdin(): string {
  return readFileSync(0, "utf8");
}

function main() {
  const ring = JSON.parse(readStdin()) as Record<string, XY[]>;

  const overridesPath = "data/map-overrides.json";
  const overrides = JSON.parse(readFileSync(overridesPath, "utf8")) as {
    stations?: Record<string, XY>;
    edges: Record<string, XY[]>;
  };

  const LANE_NAMES = ["YELLOW", "RED", "NAVY", "GREEN"];
  const COLOR_NAME = new Map(LOOP.groups.map((g, i) => [g.color, LANE_NAMES[i]]));

  let added = 0;
  const missing: string[] = [];
  for (const g of LOOP.groups) {
    const name = COLOR_NAME.get(g.color)!;
    const chain = ["flinders-street", ...g.order, g.portal];
    for (const lineId of g.lines) {
      for (let i = 0; i < chain.length - 1; i++) {
        const [a, b] = [chain[i], chain[i + 1]];
        const key = `${name}:${a}-${b}`;
        const revKey = `${name}:${b}-${a}`;
        const pts = ring[key] ?? (ring[revKey] ? ring[revKey].slice().reverse() : undefined);
        const id = `${lineId}:${a}-${b}`;
        if (!pts) {
          missing.push(id); // portal edge — add by hand per the header comment
          continue;
        }
        overrides.edges[id] = pts;
        added++;
      }
    }
  }

  writeFileSync(overridesPath, JSON.stringify(overrides, null, 2) + "\n");
  console.log(`added ${added} ring edge(s); ${missing.length} portal edge(s) still need hand routing:`, missing);
}

main();
