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
  stations?: Record<string, XY>;
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

type Anchor = "start" | "middle" | "end";
interface LabelPlacement {
  dx: number;
  dy: number;
  anchor: Anchor;
}

// Eight candidate directions at a fixed radius. Right and left first — a name
// beside a dot reads better than one above or below it, so ties go sideways.
const LABEL_R = 22;
const CANDIDATES: XY[] = [
  [1, 0],
  [-1, 0],
  [1, -0.7],
  [-1, -0.7],
  [1, 0.7],
  [-1, 0.7],
  [0, -1],
  [0, 1],
];

function anchorFor(dx: number): Anchor {
  if (dx > 4) return "start";
  if (dx < -4) return "end";
  return "middle";
}

// Score a candidate by how crowded it is: nearby stations and nearby polyline
// points both push a label away. Lower is better.
function crowding(at: XY, self: string, stations: Record<string, XY>, samples: XY[]): number {
  let score = 0;
  for (const [id, p] of Object.entries(stations)) {
    if (id === self) continue;
    const d = dist(at, p);
    if (d < 90) score += (90 - d) / 90;
  }
  for (const p of samples) {
    const d = dist(at, p);
    if (d < 45) score += ((45 - d) / 45) * 0.6;
  }
  return score;
}

function placeLabels(
  stations: Record<string, XY>,
  edges: Record<string, XY[]>,
  rendered: Set<string>
): Record<string, LabelPlacement> {
  // Sample every polyline so labels avoid sitting on top of track artwork.
  const samples: XY[] = [];
  for (const pts of Object.values(edges)) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const steps = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 30));
      for (let s = 0; s < steps; s++) {
        samples.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
      }
    }
  }

  const out: Record<string, LabelPlacement> = {};
  // Place densest-neighbourhood stations first so crowded areas get first pick.
  const order = [...rendered].sort((a, b) => {
    const ca = crowding(stations[a], a, stations, []);
    const cb = crowding(stations[b], b, stations, []);
    return cb - ca;
  });

  const taken: XY[] = [];
  for (const id of order) {
    const origin = stations[id];
    let best: LabelPlacement | null = null;
    let bestScore = Infinity;
    for (const [ux, uy] of CANDIDATES) {
      const norm = Math.hypot(ux, uy);
      const dx = (ux / norm) * LABEL_R;
      const dy = (uy / norm) * LABEL_R;
      const at: XY = [origin[0] + dx, origin[1] + dy];
      let score = crowding(at, id, stations, samples);
      // Penalise sitting on an already-placed label.
      for (const t of taken) {
        const d = dist(at, t);
        if (d < 60) score += (60 - d) / 60;
      }
      if (score < bestScore) {
        bestScore = score;
        best = { dx: Math.round(dx), dy: Math.round(dy), anchor: anchorFor(dx) };
      }
    }
    out[id] = best!;
    taken.push([origin[0] + best!.dx, origin[1] + best!.dy]);
  }
  return out;
}

function build() {
  // The extractor anchors each station to its OCR'd label, which occasionally
  // lands off the artwork — or, for Footscray, exactly on top of another
  // station. Overrides correct those by hand.
  const stations: Record<string, XY> = { ...extracted.stations, ...(overrides.stations ?? {}) };
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

  const labels = placeLabels(stations, edges, rendered);

  const out = {
    width: extracted.width,
    height: extracted.height,
    stations,
    edges,
    snapped,
    labels,
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
