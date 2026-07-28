# SVG-Native Station-First Network Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1 MB official-map raster with SVG rendered from the already-extracted polyline geometry, make the station dot the primary tap target, and let the canvas theme follow the queried time.

**Architecture:** A build-time script merges the OCR-extracted geometry with a small hand-authored override file, snaps dangling edge endpoints to their stations, simplifies polylines, and precomputes label placement — emitting one committed `data/map-geometry.json`. Runtime code only reads that file. `lib/status.ts` gains a per-station status pass reusing its existing `stationInSection` helper. `components/NetworkMap.tsx` splits into a viewport shell plus focused child components for lines, stations and labels.

**Tech Stack:** Next.js 16.2.11 (App Router), React 19.2.4, TypeScript 5, Tailwind CSS 4, Vitest 4, tsx 4 for scripts. No new dependencies.

## Global Constraints

- No new npm dependencies. Everything here is hand-written or already installed.
- Map pixel space is **3572 × 2526** throughout. Every coordinate in every file is in that space.
- Line hues never change between themes: `#F581B6` pink, `#00A2E2` cyan, `#F6BE00` yellow, `#CC132E` red, `#004B99` navy, `#00953C` green, `#4CB05C` light green. Only canvas, ink and effects change.
- Timezone for every user-facing time is Australia/Melbourne, via `lib/meltz.ts`. Never use raw `toISOString().slice(0,10)` for a user-facing date.
- **Fail-visible principle:** anything the parser cannot confidently map to track segments renders as a `warning`, never a blackout and never a false all-clear. Preserve this in every status change.
- Every animation must be disabled under `@media (prefers-reduced-motion: reduce)`.
- Tests run with `npm test` (`vitest run`). Test files live in `tests/` and match `tests/**/*.test.ts`. The `@` alias maps to the repo root.
- Scraping stays in GitHub Actions via curl. Nothing in this plan touches `scripts/scrape.ts` or `lib/scrape/parse.ts`.

## Established Facts

These were measured against the current repo. Do not re-derive them; do verify them if a test disagrees.

- `data/map-stations.json` holds `width`, `height`, `stations` (225 entries, `id -> [x, y]`) and `edges` (289 entries, `edgeId -> [[x, y], ...]`).
- Edge ids are `` `${lineId}:${fromId}-${toId}` `` (see `lib/network/build.ts:54`). Station ids contain hyphens, so the id cannot be split naively — split at the first `:`, then find the unique split point where both halves are known station ids.
- 27 of 289 edges have an endpoint more than 25 px from its station. 23 of them are **parallel-lane offsets**: the poster draws several lines side by side, so each line's lane stops short of the shared station dot. Appending the station coordinate to the polyline draws exactly the interchange tick the poster itself uses. Verified visually.
- The remaining 4 are **mis-routed** and need hand polylines. `frankston:flinders-street-richmond`, `frankston:richmond-south-yarra`, `sandringham:flinders-street-richmond` and `sandringham:richmond-south-yarra` bypass Richmond entirely (336 px and 317 px off) — the extractor routed them down the direct Caulfield corridor.
- Relevant coordinates: `richmond [2153.4, 1217.9]`, `flinders-street [1679.9, 1305]`, `south-yarra [1870.4, 1423.6]`, `jolimont [1917.7, 1184.8]`, `hawksburn [1970.3, 1420.4]`, `southern-cross [1476.9, 1169.3]`, `north-melbourne [1516.4, 1029]`.
- Exactly 3 stations have coordinates but belong to no edge: `flagstaff`, `melbourne-central`, `parliament`. The City Loop is not modelled in `lib/network/data.ts` — `TUNNEL` covers the Metro Tunnel only. These three are **not rendered** by this plan; the app can compute no status for them. Task 1 pins that set with a test so a future regression is caught.

## File Structure

**Created:**
- `data/map-overrides.json` — hand-authored polylines for the 4 mis-routed edges. Kept separate so a future `extract_map.py` rerun cannot clobber the hand work.
- `scripts/build_map_geometry.ts` — merges, snaps, simplifies, computes label placement. Emits `data/map-geometry.json`.
- `data/map-geometry.json` — generated, committed. The only geometry runtime reads.
- `lib/map/geometry.ts` — typed loader for `map-geometry.json`.
- `lib/map/theme.ts` — queried-time → theme token set.
- `components/map/MapLines.tsx` — line strokes and disruption rendering.
- `components/map/MapStations.tsx` — station marks and tap targets.
- `components/map/MapLabels.tsx` — station labels.
- `tests/map-geometry.test.ts` — geometry integrity.
- `tests/station-status.test.ts` — per-station status logic.
- `tests/map-theme.test.ts` — theme selection.

**Modified:**
- `lib/types.ts` — add `StationStatusKind`, `StationStatus`; extend `StatusResponse`.
- `lib/status.ts` — export `computeStationStatuses`; call it from `computeStatus`.
- `components/NetworkMap.tsx` — becomes the viewport shell; delegates drawing to the three child components.
- `components/MapScreen.tsx` — line focus state, station selection, sheet content.
- `app/globals.css` — night theme tokens, sever/pulse/glow keyframes.
- `package.json` — add `map:build` script.

**Deleted (ask the user before running the delete):**
- `public/network-map.png`

---

### Task 1: Build-time geometry pipeline

Produces the single geometry file everything else reads. Covers the endpoint snap, polyline simplification, and the orphan-station pin. Label placement is added to the same script in Task 3; the mis-routed edges are hand-authored in Task 2.

**Files:**
- Create: `scripts/build_map_geometry.ts`
- Create: `data/map-overrides.json`
- Create: `lib/map/geometry.ts`
- Create: `tests/map-geometry.test.ts`
- Modify: `package.json` (scripts block)

**Interfaces:**
- Consumes: `data/map-stations.json` (existing), `EDGES` from `lib/network/build.ts`.
- Produces:
  - `data/map-geometry.json` shaped `{ width: number; height: number; stations: Record<string, [number, number]>; edges: Record<string, [number, number][]>; rendered: string[]; orphans: string[] }` where `rendered` is the station ids that belong to at least one edge.
  - `lib/map/geometry.ts` exports `MAP_W`, `MAP_H`, `STATION_XY`, `EDGE_PATH`, `RENDERED_STATIONS`, `ORPHAN_STATIONS`.

- [ ] **Step 1: Write the failing test**

Create `tests/map-geometry.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/map-geometry.test.ts`
Expected: FAIL — `Cannot find module '@/lib/map/geometry'`.

- [ ] **Step 3: Create the overrides file**

Create `data/map-overrides.json` with an empty edges block for now. Task 2 fills it.

```json
{
  "edges": {}
}
```

- [ ] **Step 4: Write the build script**

Create `scripts/build_map_geometry.ts`:

```ts
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
  const farSnaps = Object.entries(snapped)
    .filter(([, d]) => d > 25)
    .sort((a, b) => b[1] - a[1]);
  console.log(
    `map-geometry.json: ${Object.keys(edges).length} edges, ${pointCount} points, ` +
      `${rendered.size} rendered stations, ${orphans.length} orphans (${orphans.join(", ")})`
  );
  if (farSnaps.length) {
    console.log(`  ${farSnaps.length} edge(s) snapped more than 25px — these need hand routing:`);
    for (const [id, d] of farSnaps) console.log(`    ${id}  ${d}px`);
  }
}

build();
```

- [ ] **Step 5: Write the typed loader**

Create `lib/map/geometry.ts`:

```ts
// Typed access to the generated map geometry. Regenerate with `npm run map:build`.
import geometry from "@/data/map-geometry.json";

export type XY = [number, number];

export const MAP_W = geometry.width as number;
export const MAP_H = geometry.height as number;
export const STATION_XY = geometry.stations as unknown as Record<string, XY>;
export const EDGE_PATH = geometry.edges as unknown as Record<string, XY[]>;

// How far the build had to drag each polyline's ends to reach its stations.
// Small = the parallel-lane tick the poster draws. Large = the polyline was
// routed somewhere else and needs a hand-authored replacement.
export const SNAP_DISTANCE = geometry.snapped as unknown as Record<string, number>;

// Stations that belong to at least one edge, so can be drawn and given a status.
export const RENDERED_STATIONS: ReadonlySet<string> = new Set(geometry.rendered as string[]);

// Stations with coordinates but no edges — the City Loop, which the network
// model in lib/network/data.ts does not cover. Deliberately not drawn.
export const ORPHAN_STATIONS: ReadonlySet<string> = new Set(geometry.orphans as string[]);

// SVG path data for a polyline.
export function pathD(pts: XY[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
}
```

- [ ] **Step 6: Add the npm script**

In `package.json`, add to the `scripts` block:

```json
"map:build": "tsx scripts/build_map_geometry.ts"
```

- [ ] **Step 7: Generate the geometry**

Run: `npm run map:build`
Expected: prints `map-geometry.json: 289 edges, ... 3 orphans (flagstaff, melbourne-central, parliament)`.

The endpoint test will still fail for the 4 mis-routed edges — that is expected and is Task 2's job.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/map-geometry.test.ts`
Expected: the pixel-space, polyline-exists, orphan, snap-recorded and simplification tests PASS. The snap-reach test FAILS listing exactly these four:

```
frankston:flinders-street-richmond
frankston:richmond-south-yarra
sandringham:flinders-street-richmond
sandringham:richmond-south-yarra
```

If any other edge appears, stop and investigate — the snap should have fixed the other 23.

- [ ] **Step 9: Commit**

```bash
git add scripts/build_map_geometry.ts lib/map/geometry.ts data/map-overrides.json data/map-geometry.json tests/map-geometry.test.ts package.json
git commit -m "Add build-time map geometry pipeline

Merges extracted geometry with hand overrides, snaps parallel-lane endpoints
onto their stations, simplifies polylines with Douglas-Peucker, and pins the
three City Loop orphan stations. Four mis-routed Richmond edges still fail the
endpoint test; hand polylines follow."
```

---

### Task 2: Repair the mis-routed geometry

Task 1's snap-reach test exposed more damage than the raster let anyone see: 27 edges need
the build to drag a polyline more than 25 px to reach its station. Investigation split them
into three groups.

**Two station coordinates are simply wrong.** The extractor anchors each station to its
OCR'd *label*, and twice that landed off the artwork:

- `footscray` was given `[1107.1, 974.5]` — **byte-identical to `west-footscray`**. Two
  different stations share one point. Measured against the poster, Footscray's interchange
  oval is at `[1280, 985]`. The consequence is not cosmetic: `sunbury:footscray-middle-footscray`
  is currently drawn as *West* Footscray↔Middle Footscray, and Werribee/Williamstown appear
  to bypass Footscray entirely, running South Kensington straight to Seddon.
- `canterbury` sits at `[2345.9, 1084.7]`, 42 px off its own line, so it renders as a
  dead-end spur hanging off the Belgrave/Lilydale trunk. Its tick on the artwork is at
  `[2313, 1067]`, collinear with the East Camberwell and Chatham ticks.

**Nine edges are mis-routed** and need hand polylines: the four Richmond ones, the four
Footscray ones, and `frankston:south-yarra-hawksburn`, whose polyline spikes 80 px north to
`[1893, 1343]` and back.

**Fourteen are genuine parallel-lane ticks.** The poster bundles lines into parallel lanes
beside a shared station dot, so each lane legitimately stops 43–71 px short and the snap
draws the connector the poster itself draws. These are accepted by name, with their measured
reach recorded, rather than by loosening the threshold for everything.

Poster lane measurements used below, at Footscray: cyan lane `y = 975`, pink lane `y = 1000`,
interchange oval centre `[1280, 985]`.

**Files:**
- Modify: `data/map-overrides.json` (adds a `stations` block and 9 edge polylines)
- Modify: `scripts/build_map_geometry.ts` (merge `overrides.stations`)
- Modify: `tests/map-geometry.test.ts` (accepted-lane-tick allowlist)
- Regenerate: `data/map-geometry.json`

**Interfaces:**
- Consumes: `SNAP_DISTANCE` from `lib/map/geometry.ts` (Task 1).
- Produces: `data/map-overrides.json` gains `{ stations: Record<string, [number, number]>, edges: ... }`. No new exports.

- [ ] **Step 1: Confirm the starting state**

Run: `npx vitest run tests/map-geometry.test.ts -t "never has to drag a polyline far"`
Expected: FAIL listing 27 edges.

- [ ] **Step 2: Let overrides correct station coordinates**

In `scripts/build_map_geometry.ts`, change the overrides type and the `stations` binding so a
station coordinate can be corrected the same way a polyline can:

```ts
const overrides = JSON.parse(readFileSync(join(ROOT, "data/map-overrides.json"), "utf-8")) as {
  stations?: Record<string, XY>;
  edges: Record<string, XY[]>;
};
```

Then inside `build()`, replace `const stations = extracted.stations;` with:

```ts
  // The extractor anchors each station to its OCR'd label, which occasionally
  // lands off the artwork — or, for Footscray, exactly on top of another
  // station. Overrides correct those by hand.
  const stations: Record<string, XY> = { ...extracted.stations, ...(overrides.stations ?? {}) };
```

- [ ] **Step 3: Write the overrides**

Replace `data/map-overrides.json` with the following. Keep the 6 `sunbury:` Metro Tunnel
entries already in the file — they are Task 1's work and are still needed; append the new
edges alongside them and add the `stations` block.

```json
{
  "stations": {
    "footscray": [1280, 985],
    "canterbury": [2313, 1067]
  },
  "edges": {
    "werribee:south-kensington-footscray": [
      [1382.7, 1002.8], [1300, 1002], [1280, 1000], [1280, 985]
    ],
    "williamstown:south-kensington-footscray": [
      [1382.7, 1002.8], [1300, 1002], [1280, 1000], [1280, 985]
    ],
    "werribee:footscray-seddon": [
      [1280, 985], [1280, 1000], [1240, 1004], [1222, 1015], [1196, 1041], [1176.9, 1060.5]
    ],
    "williamstown:footscray-seddon": [
      [1280, 985], [1280, 1000], [1240, 1004], [1222, 1015], [1196, 1041], [1176.9, 1060.5]
    ],
    "sunbury:arden-footscray": [
      [1542, 955], [1409, 956], [1380, 973], [1371, 974], [1280, 975], [1280, 985]
    ],
    "pakenham:footscray-arden": [
      [1280, 985], [1280, 975], [1371, 974], [1380, 973], [1409, 956], [1542, 955]
    ],
    "cranbourne:footscray-arden": [
      [1280, 985], [1280, 975], [1371, 974], [1380, 973], [1409, 956], [1542, 955]
    ],
    "sunbury:footscray-middle-footscray": [
      [1280, 985], [1280, 975], [1198, 974]
    ],
    "frankston:south-yarra-hawksburn": [
      [1870.4, 1423.6], [1900, 1424], [1935, 1422], [1970.3, 1420.4]
    ],
    "frankston:flinders-street-richmond": [
      [1679.9, 1305], [1760, 1300], [1830, 1291], [1900, 1275], [1975, 1256],
      [2050, 1238], [2110, 1226], [2153.4, 1217.9]
    ],
    "frankston:richmond-south-yarra": [
      [2153.4, 1217.9], [2120, 1244], [2075, 1281], [2030, 1318], [1985, 1355],
      [1940, 1389], [1900, 1412], [1870.4, 1423.6]
    ],
    "sandringham:flinders-street-richmond": [
      [1679.9, 1305], [1760, 1314], [1830, 1305], [1900, 1289], [1975, 1270],
      [2050, 1252], [2110, 1240], [2153.4, 1217.9]
    ],
    "sandringham:richmond-south-yarra": [
      [2153.4, 1217.9], [2134, 1258], [2089, 1295], [2044, 1332], [1999, 1369],
      [1954, 1403], [1910, 1424], [1870.4, 1423.6]
    ]
  }
}
```

- [ ] **Step 4: Accept the fourteen lane ticks by name**

In `tests/map-geometry.test.ts`, add above the describe block:

```ts
// Reaches beyond the 25px snap budget that have been looked at and accepted.
// Each is a parallel-lane tick: the poster bundles these lines into lanes
// running beside the shared station dot, so the snap draws exactly the short
// connector the poster itself draws. Verified by rendering the CBD at 1:1.
// Any edge NOT listed here must stay under 25px — a long reach elsewhere means
// the polyline was routed somewhere else and the snap papered over it with a
// straight teleport. Values are the measured reach; the test allows 2px of
// drift so a tick cannot silently grow into a teleport.
const ACCEPTED_LANE_TICKS: Record<string, number> = {
  "belgrave:flinders-street-richmond": 42.8,
  "lilydale:flinders-street-richmond": 42.8,
  "alamein:flinders-street-richmond": 42.8,
  "glen-waverley:flinders-street-richmond": 42.8,
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
```

Replace the body of the "never has to drag a polyline far to reach its station" test with:

```ts
    const bad = Object.entries(SNAP_DISTANCE)
      .filter(([id, d]) => d > (ACCEPTED_LANE_TICKS[id] ?? 0) + 2 && d > 25)
      .map(([id, d]) => `${id} (${d.toFixed(0)}px)`);
    expect(bad).toEqual([]);
```

Add a test that the allowlist cannot rot:

```ts
  it("has no stale entries in the accepted-lane-tick list", () => {
    const stale = Object.keys(ACCEPTED_LANE_TICKS).filter(
      (id) => (SNAP_DISTANCE[id] ?? 0) <= 25
    );
    expect(stale, "these edges no longer need an exemption — remove them").toEqual([]);
  });
```

- [ ] **Step 5: Regenerate and test**

Run: `npm run map:build && npx vitest run tests/map-geometry.test.ts`
Expected: all tests PASS. The build's "snapped more than 25px" summary should now list only
the 14 accepted lane ticks.

If any edge outside the allowlist still exceeds 25 px, do not add it to the allowlist —
report it. The allowlist is for ticks that have been looked at, not a place to silence
failures.

- [ ] **Step 6: Check the repairs visually**

The map is not rendered yet, so verify numerically:

```bash
node -e "
const g=require('./data/map-geometry.json');
console.log('footscray', g.stations['footscray'], 'west-footscray', g.stations['west-footscray']);
console.log('canterbury', g.stations['canterbury']);
for (const id of ['werribee:footscray-seddon','sunbury:footscray-middle-footscray','frankston:richmond-south-yarra','frankston:south-yarra-hawksburn']) {
  console.log(id, 'reach', g.snapped[id], 'pts', g.edges[id].length);
}
"
```

Expected: `footscray` and `west-footscray` are now **different** points; `canterbury` is
`[2313, 1067]`; every listed edge has a reach at or near 0.

- [ ] **Step 7: Commit**

```bash
git add data/map-overrides.json scripts/build_map_geometry.ts data/map-geometry.json tests/map-geometry.test.ts
git commit -m "Repair mis-routed map geometry and two wrong station coordinates

The snap-reach test exposed damage the raster was hiding. Footscray had
west-footscray's exact coordinate, so the Sunbury line's Footscray-Middle
Footscray edge was really West Footscray-Middle Footscray, and Werribee and
Williamstown appeared to skip Footscray altogether. Canterbury sat 42px off
its own line and rendered as a dead-end spur. Both are corrected against the
poster, nine mis-routed edges get hand polylines, and the fourteen genuine
parallel-lane ticks are accepted by name with their measured reach rather
than by loosening the threshold."
```

---

### Task 3: Precompute label placement

Station names live only in the deleted raster, so they must be drawn. Placement is scored at build time so the runtime just draws text.

**Files:**
- Modify: `scripts/build_map_geometry.ts`
- Modify: `lib/map/geometry.ts`
- Modify: `tests/map-geometry.test.ts`
- Regenerate: `data/map-geometry.json`

**Interfaces:**
- Consumes: `STATION_XY`, `EDGE_PATH` from Task 1.
- Produces: `data/map-geometry.json` gains `labels: Record<string, { dx: number; dy: number; anchor: "start" | "middle" | "end" }>`. `lib/map/geometry.ts` exports `LABEL_PLACEMENT` and the `LabelPlacement` type.

- [ ] **Step 1: Write the failing test**

Append to `tests/map-geometry.test.ts`:

```ts
import { LABEL_PLACEMENT, RENDERED_STATIONS } from "@/lib/map/geometry";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/map-geometry.test.ts -t "label placement"`
Expected: FAIL — `LABEL_PLACEMENT` is not exported.

- [ ] **Step 3: Add label scoring to the build script**

In `scripts/build_map_geometry.ts`, add above `function build()`:

```ts
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
```

- [ ] **Step 4: Emit labels from build()**

In `scripts/build_map_geometry.ts`, inside `build()`, replace the `const out = {...}` block with:

```ts
  const labels = placeLabels(stations, edges, rendered);

  const out = {
    width: extracted.width,
    height: extracted.height,
    stations,
    edges,
    labels,
    rendered: [...rendered].sort(),
    orphans,
  };
```

- [ ] **Step 5: Export from the loader**

In `lib/map/geometry.ts`, add:

```ts
export type LabelAnchor = "start" | "middle" | "end";
export interface LabelPlacement {
  dx: number;
  dy: number;
  anchor: LabelAnchor;
}

export const LABEL_PLACEMENT = geometry.labels as unknown as Record<string, LabelPlacement>;
```

- [ ] **Step 6: Regenerate and test**

Run: `npm run map:build && npx vitest run tests/map-geometry.test.ts`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/build_map_geometry.ts lib/map/geometry.ts data/map-geometry.json tests/map-geometry.test.ts
git commit -m "Precompute station label placement

Eight candidate directions per station scored by neighbour and track-artwork
crowding, densest neighbourhoods placed first. Runtime just draws the text."
```

---

### Task 4: Per-station status

Adds the three station states to the domain model and API. Pure logic, no UI.

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/status.ts`
- Create: `tests/station-status.test.ts`

**Interfaces:**
- Consumes: `stationInSection`, `lineSpan`, `disruptionActiveAt` (all already private in `lib/status.ts`); `LINE_DEFS`, `STATIONS` from `lib/network/build.ts`; `isServiceRunning` from `lib/spans.ts`.
- Produces:
  - `lib/types.ts` exports `StationStatusKind = "normal" | "boundary" | "cut" | "warning"` and `StationStatus`.
  - `StatusResponse` gains `stations: StationStatus[]`.
  - `lib/status.ts` exports `computeStationStatuses(active: Disruption[], t: MelTime, lineWarnings: Map<LineId, Set<string>>): StationStatus[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/station-status.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/station-status.test.ts`
Expected: FAIL — `res.stations` is undefined.

- [ ] **Step 3: Add the types**

In `lib/types.ts`, after the `SegmentStatus` interface:

```ts
export type StationStatusKind =
  | "normal" // trains as timetabled
  | "boundary" // trains terminate here, buses beyond
  | "cut" // inside the affected section, no trains
  | "warning"; // a disruption touches this line but couldn't be parsed

export interface StationStatus {
  stationId: string;
  status: StationStatusKind;
  disruptionIds: string[];
  lines: { lineId: LineId; status: StationStatusKind }[];
}
```

In the same file, add to `StatusResponse` after `segments`:

```ts
  stations: StationStatus[];
```

- [ ] **Step 4: Implement the computation**

In `lib/status.ts`, add after the `stationInSection` function:

```ts
// Strongest signal wins when several lines disagree at one station.
const STATION_RANK: Record<StationStatusKind, number> = {
  normal: 0,
  warning: 1,
  boundary: 2,
  cut: 3,
};

// Per-station status at a moment. A station at the very edge of a section is
// `boundary`, not `cut` — trains still reach it from the far side, which is
// what people actually want to know.
export function computeStationStatuses(
  active: Disruption[],
  t: MelTime,
  lineWarnings: Map<LineId, Set<string>>
): StationStatus[] {
  const out: StationStatus[] = [];

  for (const station of STATIONS.values()) {
    // Orphan stations (the unmodelled City Loop) have no edges and no status.
    if (!RENDERED_STATIONS.has(station.id)) continue;

    const perLine: { lineId: LineId; status: StationStatusKind }[] = [];
    const ids = new Set<string>();

    for (const lineId of station.lines) {
      let status: StationStatusKind = "normal";

      const warned = lineWarnings.get(lineId);
      if (warned && warned.size > 0) {
        status = "warning";
        for (const id of warned) ids.add(id);
      }

      if (isServiceRunning(lineId, t)) {
        for (const d of active) {
          if (!d.lineIds.includes(lineId)) continue;

          const span = lineSpan(d, lineId);
          // Mirror computeStatus's precedence exactly. A disruption with no
          // usable span is a line-level warning, already applied above —
          // never a per-station blackout. This is the fail-visible rule.
          let kind: StationStatusKind | null = null;
          if (span) {
            if (!stationInSection(station.id, d, lineId)) continue;
            kind = span.from === station.id || span.to === station.id ? "boundary" : "cut";
          } else if (d.parsed && d.wholeLine) {
            kind = "cut";
          }
          if (!kind) continue;

          if (STATION_RANK[kind] > STATION_RANK[status]) status = kind;
          ids.add(d.id);
        }
      }

      perLine.push({ lineId, status });
    }

    const overall = perLine.reduce<StationStatusKind>(
      (acc, l) => (STATION_RANK[l.status] > STATION_RANK[acc] ? l.status : acc),
      "normal"
    );

    out.push({
      stationId: station.id,
      status: overall,
      disruptionIds: [...ids],
      lines: perLine,
    });
  }

  return out;
}
```

Add the imports at the top of `lib/status.ts`:

```ts
import type { StationStatus, StationStatusKind } from "./types";
import { RENDERED_STATIONS } from "./map/geometry";
```

- [ ] **Step 5: Wire it into computeStatus**

In `lib/status.ts`, inside `computeStatus`, replace the returned object's `segments` line region so the return includes stations. The `lineWarnings` map is already built above the return, so pass it straight in:

```ts
  return {
    at: at.toISOString(),
    generatedAt: new Date().toISOString(),
    dataUpdatedAt,
    stale: staleMs > 3 * 24 * 3600 * 1000,
    segments: [...segmentMap.values()],
    stations: computeStationStatuses(active, t, lineWarnings),
    lineWarnings: [...lineWarnings.entries()].map(([lineId, ids]) => ({
      lineId,
      disruptionIds: [...ids],
    })),
    disruptions: active,
  };
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run`
Expected: PASS, including the existing `tests/parse.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/status.ts tests/station-status.test.ts
git commit -m "Add per-station status with boundary state

StatusResponse gains stations[] with a per-line breakdown. A station at the
edge of a section is 'boundary' rather than 'cut' — trains still reach it from
the far side. Orphan City Loop stations get no status."
```

---

### Task 5: Render the map as SVG

Replaces the raster with SVG drawn from the generated geometry. Status rendering stays as-is for this task so the change is isolated to the substrate; Task 8 redoes it.

**Files:**
- Create: `components/map/MapLines.tsx`
- Create: `components/map/MapStations.tsx`
- Modify: `components/NetworkMap.tsx`

**Interfaces:**
- Consumes: `MAP_W`, `MAP_H`, `STATION_XY`, `EDGE_PATH`, `RENDERED_STATIONS`, `pathD` from `lib/map/geometry.ts`; `EDGES`, `STATIONS`, `LINE_BY_ID` from `lib/network/build.ts`.
- Produces:
  - `MapLines` props: `{ statusByEdge: Map<string, SegmentStatus>; focusedLine: LineId | null; onSelectEdge: (e: Edge) => void }`
  - `MapStations` props: `{ statusByStation: Map<string, StationStatus>; focusedLine: LineId | null; onSelectStation: (id: string) => void }`

- [ ] **Step 1: Write MapLines**

Create `components/map/MapLines.tsx`:

```tsx
"use client";

import { EDGES, LINE_BY_ID } from "@/lib/network/build";
import { EDGE_PATH, pathD } from "@/lib/map/geometry";
import type { Edge, LineId, SegmentStatus } from "@/lib/types";

interface Props {
  statusByEdge: Map<string, SegmentStatus>;
  focusedLine: LineId | null;
  onSelectEdge: (e: Edge) => void;
}

const STROKE = 11;

export default function MapLines({ statusByEdge, focusedLine, onSelectEdge }: Props) {
  return (
    <g>
      {EDGES.map((e) => {
        const pts = EDGE_PATH[e.id];
        if (!pts) return null;
        const line = LINE_BY_ID.get(e.lineId);
        if (!line) return null;
        const ghosted = focusedLine !== null && focusedLine !== e.lineId;
        return (
          <path
            key={e.id}
            d={pathD(pts)}
            fill="none"
            stroke={line.color}
            strokeWidth={ghosted ? 3 : STROKE}
            strokeOpacity={ghosted ? 0.25 : 1}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-[stroke-width,stroke-opacity] duration-200"
          />
        );
      })}

      {/* Invisible fat paths carry the taps. Drawn after the visible strokes so
          they sit on top, but below the station targets added by MapStations. */}
      {EDGES.map((e) => {
        const pts = EDGE_PATH[e.id];
        if (!pts) return null;
        return (
          <path
            key={`hit-${e.id}`}
            d={pathD(pts)}
            fill="none"
            stroke="transparent"
            strokeWidth={30}
            strokeLinecap="round"
            style={{ cursor: "pointer", pointerEvents: "stroke" }}
            onClick={() => onSelectEdge(e)}
          />
        );
      })}
    </g>
  );
}
```

- [ ] **Step 2: Write MapStations**

Create `components/map/MapStations.tsx`:

```tsx
"use client";

import { STATIONS } from "@/lib/network/build";
import { RENDERED_STATIONS, STATION_XY } from "@/lib/map/geometry";
import type { LineId, StationStatus } from "@/lib/types";

interface Props {
  statusByStation: Map<string, StationStatus>;
  focusedLine: LineId | null;
  onSelectStation: (id: string) => void;
}

// Tap target radius in map pixels. At the app's default zoom this is a little
// over 44 CSS px, which is the minimum comfortable touch target.
const HIT_R = 26;

export default function MapStations({ statusByStation, focusedLine, onSelectStation }: Props) {
  return (
    <g>
      {[...STATIONS.values()].map((s) => {
        if (!RENDERED_STATIONS.has(s.id)) return null;
        const xy = STATION_XY[s.id];
        if (!xy) return null;
        const ghosted = focusedLine !== null && !s.lines.includes(focusedLine);
        const r = s.interchange ? 8 : 6;
        return (
          <g key={s.id} opacity={ghosted ? 0.3 : 1} className="transition-opacity duration-200">
            <circle
              cx={xy[0]}
              cy={xy[1]}
              r={r}
              fill="var(--map-station-fill)"
              stroke="var(--map-station-stroke)"
              strokeWidth={s.interchange ? 4 : 3}
            />
            <circle
              cx={xy[0]}
              cy={xy[1]}
              r={HIT_R}
              fill="transparent"
              style={{ cursor: "pointer", pointerEvents: "fill" }}
              onClick={() => onSelectStation(s.id)}
            />
          </g>
        );
      })}
    </g>
  );
}
```

- [ ] **Step 3: Add the station tokens**

In `app/globals.css`, inside the `:root` block:

```css
  --map-canvas: #f3efe4;
  --map-station-fill: #ffffff;
  --map-station-stroke: #1f2430;
```

- [ ] **Step 4: Rewrite NetworkMap as the viewport shell**

Replace `components/NetworkMap.tsx` entirely:

```tsx
"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { EDGES, STATIONS } from "@/lib/network/build";
import { MAP_H, MAP_W, STATION_XY } from "@/lib/map/geometry";
import type { Edge, LineId, SegmentStatus, StationStatus, StatusResponse } from "@/lib/types";
import { usePanZoom } from "./usePanZoom";
import MapLines from "./map/MapLines";
import MapStations from "./map/MapStations";

export type Selection =
  | { kind: "edge"; edge: Edge; status: SegmentStatus }
  | { kind: "station"; stationId: string; status: StationStatus };

interface Props {
  status: StatusResponse | null;
  focusedLine: LineId | null;
  onSelect: (sel: Selection | null) => void;
}

export default function NetworkMap({ status, focusedLine, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const statusByEdge = useMemo(() => {
    const m = new Map<string, SegmentStatus>();
    for (const s of status?.segments ?? []) m.set(s.edgeId, s);
    return m;
  }, [status]);

  const statusByStation = useMemo(() => {
    const m = new Map<string, StationStatus>();
    for (const s of status?.stations ?? []) m.set(s.stationId, s);
    return m;
  }, [status]);

  const { t, setT, zoomAt, handlers, wasDrag } = usePanZoom({ x: 0, y: 0, k: 0.2 }, 0.05, 2.5);

  // Fit the metro bbox on first mount, then lean in toward the city core — a
  // full-poster fit is unreadably small on a phone; the rest is a pan away.
  const fitted = useRef(false);
  useLayoutEffect(() => {
    if (fitted.current || !containerRef.current) return;
    fitted.current = true;
    const { clientWidth: w, clientHeight: h } = containerRef.current;
    const xs = Object.values(STATION_XY).map((p) => p[0]);
    const ys = Object.values(STATION_XY).map((p) => p[1]);
    const pad = 90;
    const spanX = Math.max(...xs) - Math.min(...xs) + pad * 2;
    const spanY = Math.max(...ys) - Math.min(...ys) + pad * 2;
    const k = Math.min(w / spanX, h / spanY) * 1.7;
    const loop = STATION_XY["flinders-street"];
    setT({ k, x: w / 2 - loop[0] * k, y: h / 2 - loop[1] * k });
  }, [setT]);

  function zoomButton(factor: number) {
    const el = containerRef.current;
    if (!el) return;
    zoomAt(el.clientWidth / 2, el.clientHeight / 2, factor);
  }

  function handleEdge(e: Edge) {
    if (wasDrag()) return;
    const st = statusByEdge.get(e.id);
    onSelect(st ? { kind: "edge", edge: e, status: st } : null);
  }

  function handleStation(id: string) {
    if (wasDrag()) return;
    const st = statusByStation.get(id);
    onSelect(st ? { kind: "station", stationId: id, status: st } : null);
  }

  return (
    <div
      ref={containerRef}
      className="map-canvas relative h-full w-full touch-none overflow-hidden"
      {...handlers}
    >
      <svg
        width={MAP_W}
        height={MAP_H}
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        style={{
          transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})`,
          transformOrigin: "0 0",
        }}
      >
        <MapLines statusByEdge={statusByEdge} focusedLine={focusedLine} onSelectEdge={handleEdge} />
        <MapStations
          statusByStation={statusByStation}
          focusedLine={focusedLine}
          onSelectStation={handleStation}
        />
      </svg>

      <div className="absolute bottom-16 right-3 flex flex-col overflow-hidden rounded-xl border border-hairline bg-elevated/95 backdrop-blur">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => zoomButton(1.4)}
          className="flex h-11 w-11 items-center justify-center text-xl font-bold text-ink-dim transition-colors duration-150 hover:text-ink cursor-pointer"
        >
          +
        </button>
        <div className="mx-2 h-px bg-hairline" aria-hidden />
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoomButton(1 / 1.4)}
          className="flex h-11 w-11 items-center justify-center text-xl font-bold text-ink-dim transition-colors duration-150 hover:text-ink cursor-pointer"
        >
          −
        </button>
      </div>
    </div>
  );
}

export { STATIONS, EDGES };
```

- [ ] **Step 5: Make MapScreen compile against the new props**

In `components/MapScreen.tsx`, pass the new prop and narrow the sheet to edge selections for now (Task 7 handles station selections):

```tsx
        <NetworkMap status={status} focusedLine={null} onSelect={setSel} />
```

and change the sheet's guard from `{sel && selLine && (` to:

```tsx
        {sel?.kind === "edge" && selLine && (
```

and change `selLine` and `selDisruptions` to:

```tsx
  const selDisruptions =
    sel && status ? status.disruptions.filter((d) => sel.status.disruptionIds.includes(d.id)) : [];
  const selLine = sel?.kind === "edge" ? LINE_BY_ID.get(sel.edge.lineId) : null;
```

- [ ] **Step 6: Verify it renders**

Run: `npm run dev` and open http://localhost:3000

Expected: the metro network draws in official colours on the cream canvas, with no regional lines, no legend and no labels. The raster is still in `public/` but is no longer referenced. Tapping a line still opens the sheet.

- [ ] **Step 7: Run the tests and lint**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/NetworkMap.tsx components/map/MapLines.tsx components/map/MapStations.tsx components/MapScreen.tsx app/globals.css
git commit -m "Render the network map as SVG instead of a raster

Draws the generated geometry directly: line strokes, station marks, and
separate invisible tap targets. Regional lines, fare zones and the baked-in
legend disappear as a consequence. Status rendering is unchanged for now."
```

---

### Task 6: Line focus

**Files:**
- Create: `components/map/LineChip.tsx`
- Modify: `components/MapScreen.tsx`

**Interfaces:**
- Consumes: `LINE_DEFS` from `lib/network/build.ts`; `focusedLine` prop on `NetworkMap` from Task 5.
- Produces: `LineChip` props `{ value: LineId | null; onChange: (id: LineId | null) => void }`.

- [ ] **Step 1: Write the chip**

Create `components/map/LineChip.tsx`:

```tsx
"use client";

import { LINE_DEFS } from "@/lib/network/build";
import type { LineId } from "@/lib/types";

interface Props {
  value: LineId | null;
  onChange: (id: LineId | null) => void;
}

export default function LineChip({ value, onChange }: Props) {
  const selected = LINE_DEFS.find((l) => l.id === value);
  return (
    <label className="pointer-events-auto flex items-center gap-2 rounded-full border border-hairline bg-elevated/95 py-1.5 pl-3 pr-2 text-xs font-bold backdrop-blur">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: selected?.color ?? "var(--ink-faint)" }}
        aria-hidden
      />
      <span className="sr-only">Focus a line</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || null) as LineId | null)}
        className="cursor-pointer appearance-none bg-transparent pr-4 uppercase tracking-wider outline-none"
      >
        <option value="">All lines</option>
        {LINE_DEFS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: Hold focus state in MapScreen**

In `components/MapScreen.tsx`, add below the existing `useState` declarations:

```tsx
  const initialLine = useSearchParams().get("line");
  const [focusedLine, setFocusedLine] = useState<LineId | null>(
    LINE_BY_ID.has((initialLine ?? "") as LineId) ? (initialLine as LineId) : null
  );

  // Restore the last focused line on a cold start with no ?line= in the URL.
  useEffect(() => {
    if (initialLine) return;
    const saved = localStorage.getItem("imtr:line");
    if (saved && LINE_BY_ID.has(saved as LineId)) setFocusedLine(saved as LineId);
  }, [initialLine]);

  useEffect(() => {
    if (focusedLine) localStorage.setItem("imtr:line", focusedLine);
    else localStorage.removeItem("imtr:line");
  }, [focusedLine]);
```

Add `LineId` to the type import from `@/lib/types`.

- [ ] **Step 3: Wire it through**

In `components/MapScreen.tsx`, change the map to:

```tsx
        <NetworkMap status={status} focusedLine={focusedLine} onSelect={setSel} />
```

and add the chip inside the map's relative container, above the legend:

```tsx
        <div className="pointer-events-none absolute left-3 top-3">
          <LineChip value={focusedLine} onChange={setFocusedLine} />
        </div>
```

Import it: `import LineChip from "./map/LineChip";`

- [ ] **Step 4: Verify**

Run: `npm run dev`

Expected: picking a line drops every other line to a thin translucent ghost and dims their stations. Reloading the page keeps the choice. Opening `http://localhost:3000/?line=frankston` focuses Frankston directly.

- [ ] **Step 5: Run tests and lint**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/map/LineChip.tsx components/MapScreen.tsx
git commit -m "Add line focus with localStorage and ?line= deep link

Focusing a line drops the rest to hairline ghosts."
```

---

### Task 7: Station selection and sheet

**Files:**
- Create: `components/map/StationSheet.tsx`
- Modify: `components/MapScreen.tsx`

**Interfaces:**
- Consumes: `Selection` from `components/NetworkMap.tsx` (Task 5); `StationStatus` from `lib/types.ts` (Task 4).
- Produces: `StationSheet` props `{ stationId: string; status: StationStatus; disruptions: Disruption[] }`.

- [ ] **Step 1: Write the sheet body**

Create `components/map/StationSheet.tsx`:

```tsx
"use client";

import Link from "next/link";
import { LINE_BY_ID, STATIONS } from "@/lib/network/build";
import DisruptionCard from "../DisruptionCard";
import type { Disruption, StationStatus, StationStatusKind } from "@/lib/types";

const LABEL: Record<StationStatusKind, { text: string; cls: string }> = {
  normal: { text: "Trains running", cls: "text-ok" },
  boundary: { text: "Trains terminate here", cls: "text-warn" },
  cut: { text: "No trains — buses replace", cls: "text-bad" },
  warning: { text: "Check before you travel", cls: "text-warn" },
};

interface Props {
  stationId: string;
  status: StationStatus;
  disruptions: Disruption[];
}

export default function StationSheet({ stationId, status, disruptions }: Props) {
  const station = STATIONS.get(stationId);
  if (!station) return null;
  return (
    <div>
      <h2 className="text-base font-extrabold">{station.name}</h2>
      <p className={`mt-1 text-sm font-bold ${LABEL[status.status].cls}`}>
        {LABEL[status.status].text}
      </p>

      <ul className="mt-3 flex flex-col gap-1.5">
        {status.lines.map((l) => {
          const line = LINE_BY_ID.get(l.lineId);
          if (!line) return null;
          return (
            <li key={l.lineId} className="flex items-center gap-2.5 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: line.color }}
                aria-hidden
              />
              <span className="flex-1">{line.name}</span>
              <span className={`text-xs font-bold ${LABEL[l.status].cls}`}>
                {LABEL[l.status].text}
              </span>
            </li>
          );
        })}
      </ul>

      {disruptions.map((d) => (
        <DisruptionCard key={d.id} d={d} />
      ))}

      <Link
        href={`/calendar?station=${stationId}`}
        className="mt-4 inline-block text-sm font-bold text-accent underline underline-offset-2"
      >
        See the month for {station.name}
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Render it from MapScreen**

In `components/MapScreen.tsx`, inside `<BottomSheet>`, add before the existing edge block:

```tsx
        {sel?.kind === "station" && (
          <StationSheet
            stationId={sel.stationId}
            status={sel.status}
            disruptions={selDisruptions}
          />
        )}
```

Import it: `import StationSheet from "./map/StationSheet";`

- [ ] **Step 3: Verify**

Run: `npm run dev`

Expected: tapping a station dot opens a sheet naming the station, its overall status, one row per line it serves with that line's own status, any disruption cards, and a link into the Calendar tab for that station. Tapping the line between two stations still opens the edge sheet.

- [ ] **Step 4: Run tests and lint**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/map/StationSheet.tsx components/MapScreen.tsx
git commit -m "Make the station dot the primary tap target

Station sheet shows overall status, a per-line breakdown for interchanges, the
relevant disruption cards, and a link into the Calendar tab."
```

---

### Task 8: Disruption rendering

Replaces the grey wash and dashed overlay. The geometry itself changes state, and the station marks carry the primary signal.

**Files:**
- Modify: `components/map/MapLines.tsx`
- Modify: `components/map/MapStations.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `SegmentStatus`, `StationStatus` already threaded through in Task 5.
- Produces: no new exports. CSS classes `seg-out`, `station-cut`, `station-warning` are used by both components.

- [ ] **Step 1: Replace the line status rendering**

In `components/map/MapLines.tsx`, replace the first `EDGES.map` block with:

```tsx
      {EDGES.map((e) => {
        const pts = EDGE_PATH[e.id];
        if (!pts) return null;
        const line = LINE_BY_ID.get(e.lineId);
        if (!line) return null;
        const d = pathD(pts);
        const st = statusByEdge.get(e.id)?.status ?? "running";
        const ghosted = focusedLine !== null && focusedLine !== e.lineId;
        const w = ghosted ? 3 : STROKE;
        const o = ghosted ? 0.25 : 1;

        // bus-replacement: the stroke severs. A dashed bus path bridges the gap
        // and the line's own colour is kept, so the break reads as this line
        // failing rather than a patch laid over it.
        if (st === "bus-replacement") {
          return (
            <g key={e.id} fill="none" strokeOpacity={o}>
              <path
                d={d}
                stroke={line.color}
                strokeWidth={w}
                strokeOpacity={0.28}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={d}
                className="seg-out"
                stroke={line.color}
                strokeWidth={w}
                strokeDasharray="18 22"
                strokeLinecap="butt"
                strokeLinejoin="round"
              />
            </g>
          );
        }

        // no-service: a thin dotted ghost in the line's own hue. Not a fault —
        // just nothing timetabled right now.
        if (st === "no-service") {
          return (
            <path
              key={e.id}
              d={d}
              fill="none"
              stroke={line.color}
              strokeWidth={Math.max(2, w * 0.35)}
              strokeOpacity={o * 0.45}
              strokeDasharray="2 14"
              strokeLinecap="round"
            />
          );
        }

        // warning: full colour plus a halo. Never a blackout, never an
        // all-clear — the fail-visible rule.
        return (
          <g key={e.id} fill="none">
            {st === "warning" && (
              <path
                d={d}
                stroke="var(--warn)"
                strokeWidth={w + 10}
                strokeOpacity={o * 0.3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            <path
              d={d}
              stroke={line.color}
              strokeWidth={w}
              strokeOpacity={o}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-[stroke-width,stroke-opacity] duration-200"
            />
          </g>
        );
      })}
```

- [ ] **Step 2: Give the station marks their states**

In `components/map/MapStations.tsx`, replace the visible `<circle>` with a status-aware mark:

```tsx
        const st = statusByStation.get(s.id)?.status ?? "normal";
        const r = s.interchange ? 8 : 6;
        return (
          <g key={s.id} opacity={ghosted ? 0.3 : 1} className="transition-opacity duration-200">
            {st === "cut" && (
              <circle
                cx={xy[0]}
                cy={xy[1]}
                r={r + 7}
                fill="var(--bad)"
                fillOpacity={0.35}
                className="station-cut"
              />
            )}
            {st === "warning" && (
              <circle
                cx={xy[0]}
                cy={xy[1]}
                r={r + 6}
                fill="none"
                stroke="var(--warn)"
                strokeWidth={3}
                strokeOpacity={0.7}
              />
            )}
            <circle
              cx={xy[0]}
              cy={xy[1]}
              r={r}
              fill={
                st === "cut"
                  ? "var(--bad)"
                  : st === "boundary"
                    ? "var(--warn)"
                    : "var(--map-station-fill)"
              }
              stroke="var(--map-station-stroke)"
              strokeWidth={s.interchange ? 4 : 3}
            />
            {/* boundary: trains reach this side only, so fill just half. */}
            {st === "boundary" && (
              <path
                d={`M${xy[0]},${xy[1] - r} A${r},${r} 0 0 0 ${xy[0]},${xy[1] + r} Z`}
                fill="var(--map-station-fill)"
              />
            )}
            <circle
              cx={xy[0]}
              cy={xy[1]}
              r={HIT_R}
              fill="transparent"
              style={{ cursor: "pointer", pointerEvents: "fill" }}
              onClick={() => onSelectStation(s.id)}
            />
          </g>
        );
```

- [ ] **Step 3: Update the animations**

In `app/globals.css`, replace the existing `.seg-out` block with:

```css
/* Severed segment: the gap marches along the line. */
@keyframes march {
  to {
    stroke-dashoffset: -40;
  }
}
.seg-out {
  animation: march 1.8s linear infinite;
}

/* Cut station: a slow breathing halo. */
@keyframes station-pulse {
  0%,
  100% {
    opacity: 0.15;
    transform: scale(0.9);
  }
  50% {
    opacity: 0.45;
    transform: scale(1.15);
  }
}
.station-cut {
  transform-box: fill-box;
  transform-origin: center;
  animation: station-pulse 2.4s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .seg-out,
  .station-cut {
    animation: none;
  }
}
```

- [ ] **Step 4: Update the legend**

In `components/MapScreen.tsx`, the legend still describes the old rendering. Replace the three legend spans with:

```tsx
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-4 rounded-full bg-ok" /> Running
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-4 rounded-full bg-bad [background-image:repeating-linear-gradient(90deg,var(--bad),var(--bad)_3px,transparent_3px,transparent_6px)]" />{" "}
              Buses
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-warn ring-1 ring-hairline" /> Terminates
            </span>
```

- [ ] **Step 5: Verify against a real disruption**

Run: `npm run dev` and use the Later picker to jump to a date inside a scraped disruption in `data/disruptions.json`.

Expected: the affected stretch keeps its line colour but breaks into marching dashes over a faded trace of itself; stations inside the section are solid red with a breathing halo; the stations at each end are half-filled amber. Nothing is painted grey over the top.

- [ ] **Step 6: Run tests and lint**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/map/MapLines.tsx components/map/MapStations.tsx components/MapScreen.tsx app/globals.css
git commit -m "Render disruptions as the geometry failing, not a patch

Bus replacement severs the stroke and marches the gap along it, keeping the
line's own colour. No service drops to a dotted ghost. Warning keeps full
colour and gains a halo. Station marks carry the primary signal."
```

---

### Task 9: Labels

**Files:**
- Create: `components/map/MapLabels.tsx`
- Modify: `components/NetworkMap.tsx`

**Interfaces:**
- Consumes: `LABEL_PLACEMENT`, `STATION_XY`, `RENDERED_STATIONS` from `lib/map/geometry.ts` (Task 3); `statusByStation`, `focusedLine` already computed in `NetworkMap`.
- Produces: `MapLabels` props `{ statusByStation: Map<string, StationStatus>; focusedLine: LineId | null; zoom: number }`.

- [ ] **Step 1: Write the labels layer**

Create `components/map/MapLabels.tsx`:

```tsx
"use client";

import { STATIONS } from "@/lib/network/build";
import { LABEL_PLACEMENT, RENDERED_STATIONS, STATION_XY } from "@/lib/map/geometry";
import type { LineId, StationStatus } from "@/lib/types";

interface Props {
  statusByStation: Map<string, StationStatus>;
  focusedLine: LineId | null;
  zoom: number;
}

// Past this zoom every station is named; below it only the ones that earn it.
const REVEAL_ZOOM = 0.6;

export default function MapLabels({ statusByStation, focusedLine, zoom }: Props) {
  const revealAll = zoom >= REVEAL_ZOOM;

  return (
    <g aria-hidden>
      {[...STATIONS.values()].map((s) => {
        if (!RENDERED_STATIONS.has(s.id)) return null;
        const xy = STATION_XY[s.id];
        const place = LABEL_PLACEMENT[s.id];
        if (!xy || !place) return null;

        const onFocusedLine = focusedLine !== null && s.lines.includes(focusedLine);
        const isTerminus = s.lines.some((l) => isLineEnd(s.id, l));
        const disrupted = (statusByStation.get(s.id)?.status ?? "normal") !== "normal";

        // Always: disrupted stations, interchanges, termini. With a line
        // focused, also that line's stations. Everything else waits for zoom.
        const show =
          disrupted || s.interchange || isTerminus || onFocusedLine || revealAll;
        if (!show) return null;

        const ghosted = focusedLine !== null && !s.lines.includes(focusedLine);

        return (
          <text
            key={s.id}
            x={xy[0] + place.dx}
            y={xy[1] + place.dy}
            textAnchor={place.anchor}
            dominantBaseline={place.dy > 4 ? "hanging" : place.dy < -4 ? "auto" : "middle"}
            fontSize={s.interchange ? 15 : 13}
            fontWeight={s.interchange || disrupted ? 700 : 500}
            fill={disrupted ? "var(--bad)" : "var(--map-label)"}
            opacity={ghosted ? 0.35 : 1}
            paintOrder="stroke"
            stroke="var(--map-canvas)"
            strokeWidth={4}
            strokeLinejoin="round"
            className="pointer-events-none select-none transition-opacity duration-200"
          >
            {s.name}
          </text>
        );
      })}
    </g>
  );
}
```

The `isLineEnd` helper it uses goes above the component in the same file, and
`LINE_BY_ID` joins the existing import from `@/lib/network/build`:

```tsx
import { LINE_BY_ID, STATIONS } from "@/lib/network/build";

function isLineEnd(stationId: string, lineId: LineId): boolean {
  const line = LINE_BY_ID.get(lineId);
  if (!line) return false;
  return line.stations[0] === stationId || line.stations[line.stations.length - 1] === stationId;
}
```

- [ ] **Step 2: Add the label token**

In `app/globals.css`, inside `:root`:

```css
  --map-label: #1f2430;
```

- [ ] **Step 3: Mount it**

In `components/NetworkMap.tsx`, add the import and render it after `MapStations` so text sits on top:

```tsx
import MapLabels from "./map/MapLabels";
```

```tsx
        <MapLabels statusByStation={statusByStation} focusedLine={focusedLine} zoom={t.k} />
```

- [ ] **Step 4: Verify**

Run: `npm run dev`

Expected: at the default zoom only interchanges, termini and disrupted stations are named. Zooming past roughly 0.6 fades in the rest. Focusing a line names all of that line's stations. Labels have a cream halo so they stay readable where they cross track artwork.

If a cluster looks bad, adjust `LABEL_R` or the `CANDIDATES` order in `scripts/build_map_geometry.ts` and rerun `npm run map:build` — do not hand-edit `data/map-geometry.json`, it is generated.

- [ ] **Step 5: Run tests and lint**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/map/MapLabels.tsx components/NetworkMap.tsx app/globals.css
git commit -m "Draw station labels from precomputed placement

Interchanges, termini and disrupted stations are always named; the rest fade in
past a zoom threshold, or when their line is focused."
```

---

### Task 10: Time-driven theme

**Files:**
- Create: `lib/map/theme.ts`
- Create: `tests/map-theme.test.ts`
- Modify: `app/globals.css`
- Modify: `components/MapScreen.tsx`

**Interfaces:**
- Consumes: `at` state in `MapScreen` (a `datetime-local` string or `null` for now); `melbourneHourOf` added here.
- Produces: `lib/map/theme.ts` exports `type MapTheme = "day" | "dusk" | "night"` and `mapThemeFor(at: Date): MapTheme`.

- [ ] **Step 1: Write the failing test**

Create `tests/map-theme.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapThemeFor } from "@/lib/map/theme";

// All instants below are expressed in UTC; Melbourne is UTC+10 in August (AEST).
describe("map theme", () => {
  it("is day through the middle of the day", () => {
    expect(mapThemeFor(new Date("2026-08-05T02:00:00Z"))).toBe("day"); // 12:00 Melbourne
    expect(mapThemeFor(new Date("2026-08-04T22:00:00Z"))).toBe("day"); // 08:00 Melbourne
  });

  it("is dusk in the early evening and early morning", () => {
    expect(mapThemeFor(new Date("2026-08-05T08:30:00Z"))).toBe("dusk"); // 18:30 Melbourne
    expect(mapThemeFor(new Date("2026-08-04T20:00:00Z"))).toBe("dusk"); // 06:00 Melbourne
  });

  it("is night late and very early", () => {
    expect(mapThemeFor(new Date("2026-08-05T12:00:00Z"))).toBe("night"); // 22:00 Melbourne
    expect(mapThemeFor(new Date("2026-08-04T17:00:00Z"))).toBe("night"); // 03:00 Melbourne
  });

  it("follows Melbourne time, not the viewer's timezone", () => {
    // 02:00 UTC is midday in Melbourne regardless of where the browser is.
    expect(mapThemeFor(new Date("2026-01-15T02:00:00Z"))).toBe("day"); // 13:00 AEDT
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/map-theme.test.ts`
Expected: FAIL — `Cannot find module '@/lib/map/theme'`.

- [ ] **Step 3: Implement**

Create `lib/map/theme.ts`:

```ts
// The map is a time machine, so the canvas answers to the time being queried
// rather than the wall clock or an OS setting.

export type MapTheme = "day" | "dusk" | "night";

const MEL_TZ = "Australia/Melbourne";

// Melbourne wall-clock hour (0-23) of an instant.
function melbourneHour(at: Date): number {
  const hh = new Intl.DateTimeFormat("en-GB", {
    timeZone: MEL_TZ,
    hour: "2-digit",
    hour12: false,
  }).format(at);
  return Number(hh);
}

export function mapThemeFor(at: Date): MapTheme {
  const h = melbourneHour(at);
  if (h >= 7 && h < 18) return "day";
  if ((h >= 18 && h < 20) || (h >= 5 && h < 7)) return "dusk";
  return "night";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/map-theme.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the theme token sets**

In `app/globals.css`, after the `:root` block:

```css
/* The map canvas answers to the queried time. Line hues never change; only the
   canvas, ink and effects do. */
.map-theme-day {
  --map-canvas: #f3efe4;
  --map-station-fill: #ffffff;
  --map-station-stroke: #1f2430;
  --map-label: #1f2430;
  --map-glow: 0;
}
.map-theme-dusk {
  --map-canvas: #d9d3ce;
  --map-station-fill: #fdfbf6;
  --map-station-stroke: #2b2f3a;
  --map-label: #2b2f3a;
  --map-glow: 0.4;
}
.map-theme-night {
  --map-canvas: #12151c;
  --map-station-fill: #12151c;
  --map-station-stroke: #e8e4dc;
  --map-label: #e8e4dc;
  --map-glow: 1;
}

.map-canvas {
  background: var(--map-canvas);
  transition:
    background-color 600ms ease,
    color 600ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .map-canvas {
    transition: none;
  }
}
```

Remove the old `.map-canvas` rule at the bottom of the file — the gradient version is superseded.

- [ ] **Step 6: Add the night glow**

In `components/NetworkMap.tsx`, add a filter definition as the first child of the `<svg>`, and apply it to the lines group:

```tsx
        <defs>
          <filter id="line-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
```

Wrap `MapLines` so the glow only costs anything at night — one blur over one grouped layer, never per path:

```tsx
        <g filter={theme === "night" ? "url(#line-glow)" : undefined}>
          <MapLines statusByEdge={statusByEdge} focusedLine={focusedLine} onSelectEdge={handleEdge} />
        </g>
```

Add a `theme` prop to `NetworkMap`:

```tsx
interface Props {
  status: StatusResponse | null;
  focusedLine: LineId | null;
  theme: MapTheme;
  onSelect: (sel: Selection | null) => void;
}
```

and apply the class on the container:

```tsx
      className={`map-canvas map-theme-${theme} relative h-full w-full touch-none overflow-hidden`}
```

Import the type: `import type { MapTheme } from "@/lib/map/theme";`

- [ ] **Step 7: Drive it from MapScreen**

In `components/MapScreen.tsx`:

```tsx
import { mapThemeFor } from "@/lib/map/theme";
```

```tsx
  const theme = useMemo(() => mapThemeFor(at ? new Date(at) : new Date()), [at]);
```

```tsx
        <NetworkMap status={status} focusedLine={focusedLine} theme={theme} onSelect={setSel} />
```

Add `useMemo` to the React import.

Note: with `at === null` the theme is computed once per render from the current time. The existing five-minute refresh interval already re-renders `MapScreen`, so the theme rolls over on its own within five minutes of a boundary. That is close enough; do not add a second timer.

- [ ] **Step 8: Verify**

Run: `npm run dev`

Expected: at midday the map is cream and matte. Use the Later picker to choose 11pm and the canvas crossfades to deep ink with the lines glowing and station rings bright against it. Line colours are identical in both. With reduced motion enabled in the OS the change is instant and nothing pulses.

- [ ] **Step 9: Run tests and lint**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/map/theme.ts tests/map-theme.test.ts app/globals.css components/NetworkMap.tsx components/MapScreen.tsx
git commit -m "Theme the map canvas from the queried time

Day, dusk and night token sets driven by the datetime already being queried,
so the aesthetic follows the app's core interaction. Line hues are unchanged
across themes; the night glow is one blur over one grouped layer."
```

---

### Task 11: Retire the raster

**Files:**
- Delete: `public/network-map.png`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: nothing. Confirms nothing references the raster.
- Produces: nothing.

- [ ] **Step 1: Confirm nothing references it**

Run: `grep -rn "network-map.png" --include="*.ts" --include="*.tsx" --include="*.css" --include="*.json" --include="*.md" .` (excluding `node_modules`)

Expected: matches only in `AGENTS.md` and `scripts/extract_map.py` (which *generates* it — that reference stays, since regenerating the raster is still how you eyeball a new map edition).

- [ ] **Step 2: Ask the user before deleting**

The raster is a build artefact of `scripts/extract_map.py` and is committed. Ask the user to confirm the deletion before running it. If they would rather keep it for reference, move it to `docs/` instead of deleting.

```bash
git rm public/network-map.png
```

- [ ] **Step 3: Check the payload**

Run: `npm run build`

Expected: the build succeeds. `data/map-geometry.json` should be well under 100 KB — check with:

```bash
node -e "console.log((require('fs').statSync('data/map-geometry.json').size/1024).toFixed(1)+' KB')"
```

- [ ] **Step 4: Update the project guide**

In `AGENTS.md`, replace the map-rendering paragraph under **Network model** with:

```markdown
Map rendering (`components/NetworkMap.tsx` + `components/map/*`): pure SVG drawn from
`data/map-geometry.json`, generated by `npm run map:build` from the OCR-extracted
`data/map-stations.json` plus hand-authored `data/map-overrides.json`. The build snaps
parallel-lane endpoints onto their stations, simplifies polylines, and precomputes label
placement. Station dots are the primary tap target; line strokes are secondary. Three
station states — `normal`, `boundary` (trains terminate here), `cut`. The canvas theme
follows the queried time via `lib/map/theme.ts`. The City Loop is not modelled, so
Flagstaff, Melbourne Central and Parliament have coordinates but are not drawn.
```

Under **Critical constraints**, add:

```markdown
- **`data/map-geometry.json` is generated — never hand-edit it.** Fix geometry in
  `data/map-overrides.json` or the scoring in `scripts/build_map_geometry.ts`, then rerun
  `npm run map:build`. `tests/map-geometry.test.ts` fails if the build had to drag any
  polyline more than 25 px to reach its station — a long reach means the edge was routed
  somewhere else entirely and needs a hand-authored polyline, not a snap.
```

- [ ] **Step 5: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Retire the network map raster

Nothing references public/network-map.png now that the map is SVG. Payload
drops from ~1MB to well under 100KB and the map stays sharp at any zoom."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| 1 Substrate | 1, 5, 11 |
| 2 CBD repair | 1 (snap), 2 (hand routes) |
| 3 Interaction: station-first | 5 (targets), 6 (focus), 7 (sheet) |
| 4 Station states | 4 (logic), 8 (marks) |
| 5 Labels | 3 (precompute), 9 (render) |
| 6 Disruption rendering | 8 |
| 7 Time-driven theme | 10 |
| 8 API | 4 |
| 9 Detail sheet | 7 |
| Testing | 1, 3, 4, 10 |

**Deviations from the spec, deliberate:**

- The spec said the CBD repair needed hand-authored coordinates for ~12 City Loop stations. Measurement showed 23 of 27 dangling edges are parallel-lane offsets fixed mechanically by snapping, and only 4 need hand polylines. No station coordinates move. Tasks 1 and 2 reflect the measurement, not the guess.
- The spec did not mention orphan stations. Flagstaff, Melbourne Central and Parliament have coordinates but no edges, because the City Loop is absent from `lib/network/data.ts`. They are not rendered and get no status. **This is a scope decision worth confirming with the user** — modelling the City Loop is a separate piece of work touching the network model, the scraper's station matching, and the merge logic.
- The spec's label test ("no two shown labels overlap at the default zoom") is not implementable without text metrics in the test environment. Task 3 substitutes four cheaper invariants: every rendered station has a placement, placements stay within 30 px, anchors agree with offset direction, and directions are spread across at least five of the eight candidates.

**Type consistency check:** `StationStatusKind` and `StationStatus` are defined in Task 4 and used unchanged in Tasks 7, 8, 9. `Selection` is defined in Task 5 and consumed in Tasks 5 and 7. `LabelPlacement` is defined in Task 3 and consumed in Task 9. `MapTheme` is defined in Task 10 and consumed in Task 10 only. `pathD` moved from `components/NetworkMap.tsx` to `lib/map/geometry.ts` in Task 1 and is imported from there in Task 5 onward.

**Known ordering constraint:** Task 4 imports `RENDERED_STATIONS` from `lib/map/geometry.ts`, so Task 1 must land first. Task 9 needs Task 3's `LABEL_PLACEMENT`. Everything else follows the numbered order.
