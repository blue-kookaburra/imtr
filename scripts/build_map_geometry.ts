// Build-time map geometry pipeline.
//
// Merges the OCR-extracted geometry (data/map-stations.json) with hand-authored
// overrides (data/map-overrides.json), snaps dangling endpoints onto their
// stations, simplifies polylines, and writes data/map-geometry.json — the only
// geometry the runtime reads.
//
// Run with: npm run map:build

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { EDGES } from "../lib/network/build";

type XY = [number, number];

const ROOT = join(__dirname, "..");
const extracted = JSON.parse(readFileSync(join(ROOT, "data/map-stations.json"), "utf-8")) as {
  width: number;
  height: number;
  stations: Record<string, XY>;
  edges: Record<string, XY[]>;
};
const overrides = JSON.parse(readFileSync(join(ROOT, "data/map-overrides.json"), "utf-8")) as {
  edges: Record<string, XY[]>;
};

const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Ramer-Douglas-Peucker. Tolerance is in map pixels; 1.5 px on a 3572 px-wide
// map is well below one screen pixel at the zoom levels the app offers.
function simplify(pts: XY[], tol: number): XY[] {
  if (pts.length < 3) return pts;
  const first = pts[0];
  const last = pts[pts.length - 1];
  let maxDist = -1;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDistance(pts[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      idx = i;
    }
  }
  if (maxDist <= tol) return [first, last];
  const left = simplify(pts.slice(0, idx + 1), tol);
  const right = simplify(pts.slice(idx), tol);
  return [...left.slice(0, -1), ...right];
}

function perpendicularDistance(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return dist(p, a);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

// The poster draws parallel lines side by side, so a line's lane often stops
// short of the shared station dot. Appending the station coordinate draws the
// same interchange tick the poster uses.
//
// Returns the snapped polyline and how far the snap had to reach — the reach
// is the only evidence left afterwards that the polyline didn't already go
// where it claimed, so it is recorded and asserted on.
function snapEnds(pts: XY[], from: XY, to: XY): { pts: XY[]; reach: number } {
  const fwd = dist(pts[0], from) + dist(pts[pts.length - 1], to);
  const rev = dist(pts[0], to) + dist(pts[pts.length - 1], from);
  const [head, tail] = fwd <= rev ? [from, to] : [to, from];
  const out = pts.map((p) => [p[0], p[1]] as XY);
  const headReach = dist(out[0], head);
  const tailReach = dist(out[out.length - 1], tail);
  if (headReach > 2) out.unshift(head);
  if (tailReach > 2) out.push(tail);
  return { pts: out, reach: Math.max(headReach, tailReach) };
}

function build() {
  const stations = extracted.stations;
  const edges: Record<string, XY[]> = {};
  const snapped: Record<string, number> = {};
  const rendered = new Set<string>();
  const missing: string[] = [];

  for (const e of EDGES) {
    const raw = overrides.edges[e.id] ?? extracted.edges[e.id];
    if (!raw) {
      missing.push(e.id);
      continue;
    }
    const from = stations[e.from];
    const to = stations[e.to];
    if (!from || !to) {
      missing.push(e.id);
      continue;
    }
    // Hand-authored polylines are authored to land on their stations already,
    // but snapping them is harmless and keeps one code path.
    const snap = snapEnds(raw, from, to);
    edges[e.id] = simplify(snap.pts, 1.5);
    snapped[e.id] = Number(snap.reach.toFixed(1));
    rendered.add(e.from);
    rendered.add(e.to);
  }

  if (missing.length) {
    throw new Error(`No polyline for ${missing.length} edge(s): ${missing.join(", ")}`);
  }

  const orphans = Object.keys(stations)
    .filter((id) => !rendered.has(id))
    .sort();

  const out = {
    width: extracted.width,
    height: extracted.height,
    stations,
    edges,
    snapped,
    rendered: [...rendered].sort(),
    orphans,
  };
  writeFileSync(join(ROOT, "data/map-geometry.json"), JSON.stringify(out) + "\n");

  const pointCount = Object.values(edges).reduce((n, p) => n + p.length, 0);
  console.log(
    `map-geometry.json: ${Object.keys(edges).length} edges, ${pointCount} points, ` +
      `${rendered.size} rendered stations, ${orphans.length} orphans (${orphans.join(", ")})`
  );

  const farSnaps = Object.entries(snapped)
    .filter(([, d]) => d > 25)
    .sort((a, b) => b[1] - a[1]);
  if (farSnaps.length) {
    console.log(`  ${farSnaps.length} edge(s) snapped more than 25px — these need hand routing:`);
    for (const [id, d] of farSnaps) console.log(`    ${id}  ${d}px`);
  }
}

build();
