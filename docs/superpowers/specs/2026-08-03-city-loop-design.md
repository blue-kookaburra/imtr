# City Loop modelling — design

**Date:** 2026-08-03
**Branch:** builds on `svg-network-map` (complete at `3a076af`), and gates its merge to `main`:
the user has ruled the new SVG map must not replace the raster until Flagstaff, Melbourne
Central and Parliament — which the raster showed — draw with full disruption fidelity.

## Problem

The network model (`lib/network/data.ts`) defines lines as ordered station lists. The City
Loop is absent: no line's array contains `flagstaff`, `melbourne-central` or `parliament`,
so they derive no edges, get no status, and don't render. The scraper aliases their names
to `flinders-street`, which approximates section cuts and silently mislocates loop-specific
disruptions. Real disruption text already names them ("Buses replace evening trains between
Parliament, Alamein and Box Hill" — live in `data/disruptions.json`), and the classic
Melbourne pattern "trains run direct to Flinders Street, not via the City Loop" — line
running, loop stations closed — is inexpressible.

## Ground truth (verified against the 2026 poster)

Colour-sampling the ring artwork in `docs/network-map.png`: the loop carries **yellow,
red, navy and green** lanes. Nine lines serve it — Craigieburn, Upfield (yellow); Mernda,
Hurstbridge (red); Belgrave, Lilydale, Alamein, Glen Waverley (navy); Frankston (green).
Pink (Werribee/Williamstown/Sandringham) and cyan (Metro Tunnel lines) run direct.
Flagstaff, Melbourne Central and Parliament already have extracted poster coordinates in
`data/map-stations.json`.

## Decisions taken

- **Scope: full fidelity.** Loop stations drawn, tappable, with real per-line status;
  disruptions naming them map to them; "direct to Flinders Street" renders as loop cut,
  trunk running.
- **Baseline service: loop is served whenever its line runs.** No loop-specific timetable
  windows — matches the line-level span model used everywhere else. Disruptions override.
- **Structure: overlay entity** (approach A). The ring is a first-class structure beside
  `LINES`; the arrays — which `scripts/extract_map.py`, the geometry build, edge ids,
  spans and the scraper's matching all key off — stay byte-identical. Rejected: inserting
  loop stations into the arrays (re-keys everything downstream and still cannot express
  the Northern group's cycle through both Southern Cross and the loop); a full graph
  refactor (rewrites scraper/merge/geometry for five stations).

## Design

### 1. Data model — `lib/network/data.ts`

```ts
export const LOOP = {
  // Travel order around the ring, city end anchored at flinders-street.
  ring: ["flinders-street", "southern-cross", "flagstaff", "melbourne-central", "parliament"],
  groups: [
    { color: YELLOW, lines: ["craigieburn", "upfield"],                          portal: "north-melbourne" },
    { color: RED,    lines: ["mernda", "hurstbridge"],                           portal: "jolimont" },
    { color: NAVY,   lines: ["belgrave", "lilydale", "alamein", "glen-waverley"], portal: "richmond" },
    { color: GREEN,  lines: ["frankston"],                                        portal: "richmond" },
  ],
} as const;
```

The existing unused `CITY_LOOP` constant folds into this. `LINES` arrays untouched.

### 2. Build — `lib/network/build.ts`

Derives, per serving line (matching the existing per-line edge-id convention,
`werribee:newport-seaholme`):

- ring-segment edges between consecutive ring stations
  (`craigieburn:southern-cross-flagstaff`, `belgrave:melbourne-central-parliament`, …),
- the ring closure `parliament-flinders-street`, so the loop is a loop,
- portal edges where the poster draws a lane joining the ring to that group's trunk
  (exact per-group connectivity is traced from the poster artwork during implementation —
  the spec does not pre-commit lane topology the drawing must decide).

Lines within a group share identical polyline coordinates, so nine per-line edges render
as the poster's four group-coloured lanes. Flagstaff, Melbourne Central and
Parliament become real `Station`s with `lines` = union of their serving groups' lines and
`interchange: true`, so the existing rendering, labelling, tap and sheet pipelines pick
them up with **zero component changes**.

### 3. Status — `lib/status.ts`

Loop edges merge per serving line exactly as trunk edges do: running inside the line's
span, overridden by disruptions whose section includes the loop stretch. Loop stations go
through the existing `computeStationStatuses` machinery — worst-of-lines headline,
per-line breakdown, separate `unmapped`, `no-service` when all serving lines sleep. No new
status states.

### 4. Parser — `lib/scrape/parse.ts`

- Remove the loop-station → `flinders-street` alias; the names resolve as themselves.
- Section cutting uses an **augmented match sequence** per line: the city-end loop
  stations spliced in travel order ahead of the trunk (belgrave:
  `[flinders-street, southern-cross, flagstaff, melbourne-central, parliament, richmond, …]`),
  so "between Parliament, Alamein and Box Hill" cuts Parliament→Box Hill including the
  ring stretch. The drawn path and the match sequence are deliberately distinct concepts.
- New pattern for loop-only disruptions — "direct to Flinders Street", "not via the City
  Loop", "will not stop at Flagstaff, Melbourne Central and Parliament" — producing a
  section covering the ring edges and three stations only, trunk untouched.
- Anything loop-flavoured the parser cannot place confidently falls back to the line-level
  ⚠ warning. The fail-visible principle is preserved unchanged.

### 5. Geometry and rendering

Ring polylines hand-authored in `data/map-overrides.json`, traced off the poster artwork
(present and verified; station coords already extracted), then `npm run map:build`. Loop
edges render as parallel group-coloured lanes exactly like the poster — they are ordinary
edges with geometry, so `MapLines`' existing rendering (including disruption states) and
`MapStations`/`MapLabels`/`StationSheet` need no changes. Deliberate lane offsets go in
`tests/map-geometry.test.ts`'s `ACCEPTED_LANE_TICKS` allowlist, per that file's documented
purpose (a record of geometry that has been looked at).

### 6. Testing

- **Parse:** fixture with the real "between Parliament, Alamein and Box Hill" text cutting
  through the ring; a "direct to Flinders Street" fixture for the loop-only case; loop
  names no longer aliasing to Flinders Street.
- **Status:** loop station at 3am (all lines asleep → `no-service`); loop cut while trunk
  runs (the full-fidelity case); worst-of-lines at a loop station.
- **Geometry:** the three stations present in `RENDERED_STATIONS` with label placements;
  ring edges within snap tolerance or explicitly allowlisted.
- **Labels:** the collision test's always-shown set automatically grows by three
  interchanges — must stay green (fix via `LABEL_OVERRIDES` if not, never by weakening
  the test).

## Blast radius

`lib/network/data.ts`, `lib/network/build.ts`, `lib/status.ts`, `lib/scrape/parse.ts`,
`data/map-overrides.json` (+ regenerated `data/map-geometry.json`), tests. No component
changes expected. `scripts/extract_map.py` untouched.

## Out of scope

- Loop-specific timetable windows (direction changes, evening direct running as baseline).
- Modelling Southern Cross ↔ loop as a distinct Northern-group cycle; the ring order above
  is the drawn/matched order, not a train-movement simulation.
- Any change to the 16 line arrays.
