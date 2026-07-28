# Network map redesign: SVG-native, station-first

Date: 2026-07-29
Status: approved, not yet implemented
Supersedes the map-rendering portion of `2026-07-25-is-my-train-running-design.md`.

## Problem

The Map tab renders `public/network-map.png` — a 1 MB raster of the official Victorian
train network poster — with SVG status strokes painted on top. Three complaints:

1. **Cluttered on a phone.** The poster carries every regional line, fare-zone shading,
   a full legend and 400-odd labels. Almost none of it serves the question "is my metro
   train running?".
2. **Overlays read as stickers.** Because the raster cannot be restyled, a disrupted
   segment is drawn by washing out the printed colour with a grey stroke and laying a
   dashed line over it. It looks applied to the map rather than part of it.
3. **Lifeless.** A raster cannot change with the time being queried, cannot dim, cannot
   glow. Nothing signals that this is a live status view.

A fourth problem is latent: the raster is hiding a geometry defect (see below).

## What already exists

`data/map-stations.json` holds 225 station coordinates and 289 per-edge polylines in
map pixel space (3572 × 2526), produced by `scripts/extract_map.py` — OCR of the poster's
station labels, snapped to colour-matched vector paths, with every edge Dijkstra-routed
along the drawn artwork. This is already a vector trace of the network. No manual tracing
in Illustrator or any other tool is required.

Rendering those polylines standalone yields a clean metro-only diagram. Verified:
262 of 289 edges have both endpoints within 25 px of their stations.

`lib/status.ts` already exposes `stationInSection(stationId, disruption, lineId)` — the
Calendar tab computes per-station statuses with it. Station-level status is therefore an
existing concept, not new machinery.

## The hidden defect

27 of 289 edges dangle: their polyline endpoints sit far from the stations they claim to
connect. All of them are in the CBD.

| Edge group | Gap |
|---|---|
| `craigieburn` / `upfield` → `flinders-street`, `southern-cross` | 71 px |
| `frankston:flinders-street-richmond`, `richmond-south-yarra` | 84–90 px |
| `sandringham:richmond-south-yarra` | 64 px |
| `mernda` / `hurstbridge` → `flinders-street` | 57 px |
| `belgrave` / `lilydale` / `alamein` / `glen-waverley` → `flinders-street` | 43 px |
| `north-melbourne`, `seddon`, `canterbury` approaches | 27–49 px |

Flagstaff, Melbourne Central and Parliament are present as coordinates but connect to no
edge at all. This is not an extraction failure: the City Loop is simply not modelled in
`lib/network/data.ts`, which covers the Metro Tunnel but no loop ring. The app can
therefore compute no status for those three, and they are **not rendered**. Modelling the
City Loop is separate work touching the network model, the scraper's station matching and
the merge logic; it is out of scope here. A test pins the orphan set to exactly those
three so a regression is caught.

Today the printed map underneath draws the correct picture, so the gaps are invisible.
Removing the raster exposes all of them. Repairing the CBD is therefore a hard
prerequisite, not a polish item.

## Design

### 1. Substrate

Delete `public/network-map.png`. `components/NetworkMap.tsx` renders `map-stations.json`
directly as SVG: 289 polylines, 225 dots, metro lines only. Regional lines, fare zones,
the baked-in legend and the poster's own labels disappear as a consequence of the change
rather than needing to be suppressed.

Polylines are simplified with Douglas–Peucker at build time (tolerance ~1.5 px in map
space, imperceptible at any zoom the app offers). Target payload ≈ 30 KB versus 1 MB
today, and the map stays sharp at every zoom level.

### 2. CBD repair

New file `data/map-overrides.json`, merged over the extracted data at build time:

```jsonc
{
  "stations": { "flagstaff": [1620, 1105], ... },   // ~12 City Loop / Metro Tunnel nodes
  "edges": { "craigieburn:flinders-street-southern-cross": [[x,y], ...], ... }
}
```

Keeping overrides in a separate file means a future `extract_map.py` rerun against a new
poster edition cannot clobber the hand work.

Measurement during planning narrowed this considerably. 23 of the 27 dangling edges are
**parallel-lane offsets** — the poster draws several lines side by side, so each line's
lane stops short of the shared station dot. Appending the station coordinate to the
polyline draws exactly the interchange tick the poster itself uses, and it is purely
mechanical. Verified visually.

Only 4 edges are genuinely mis-routed and need hand polylines:
`frankston:flinders-street-richmond`, `frankston:richmond-south-yarra`,
`sandringham:flinders-street-richmond` and `sandringham:richmond-south-yarra`, all of
which bypass Richmond entirely (336 px and 317 px off) because the extractor routed them
down the direct Caulfield corridor. **No station coordinates move.**

A test asserts every edge's polyline endpoints land within 25 px of its `from` and `to`
station coordinates, so the defect cannot silently return.

### 3. Interaction: station-first

The station dot is the primary tap target — a 44 px invisible hit circle, taking
precedence over edge strokes wherever they overlap. Edge strokes remain tappable as a
secondary target for "what's happening along this stretch". Tapping an unlabelled dot
reveals its name immediately, whatever the current zoom.

Line focus:

- Nothing selected — every line at base weight, disrupted lines lit. Answers "is anything
  broken?" at a glance.
- A line selected — full colour and labels for that line, every other line dropped to a
  hairline ghost.
- Selection persists in `localStorage` and is deep-linkable as `?line=frankston`.

### 4. Station states

Three states, not two. A disruption between Richmond and Caulfield still leaves both of
those stations reachable from the far side; an edge-only model cannot express that, and
"can I still get to Richmond?" is the question people actually ask.

| State | Meaning | Mark |
|---|---|---|
| `normal` | trains as timetabled | plain ring |
| `boundary` | trains terminate here, buses beyond | half-filled pip |
| `cut` | inside the affected section, no trains | filled, pulsing |
| `warning` | a disruption touches this line but could not be parsed to a section | ring plus halo |

Derived from `stationInSection` plus the station's position within the disruption's
`fromStation`/`toStation` span. `warning` comes from `lineWarnings` and applies to every
station on the affected line; it outranks `normal` and is outranked by `cut`.

### 5. Labels

Placement is precomputed at build time into `map-stations.json` as
`{ dx, dy, anchor }` per station: eight candidate directions scored by how crowded each
is with neighbouring stations and edge polylines, lowest score wins. Runtime simply draws
the text. A manual override block covers the handful that land badly.

With a line focused, labels show for that line's stations plus all interchanges and line
termini. With no line focused, only interchanges and termini are labelled. In both cases
every other station stays a bare dot until zoom passes a threshold, then its name fades
in. Any station in a `cut`, `boundary` or `warning` state is always labelled regardless
of focus or zoom.

### 6. Disruption rendering

No wash, no patch. The line's own geometry carries the state:

- **bus-replacement** — the stroke severs. Both cut ends are capped and pulse; a dashed
  bus path bridges the gap.
- **no-service** — the stroke drops to a thin dotted ghost in the line's own hue.
- **warning** — the line keeps its full colour and gains a stroked halo, preserving the
  fail-visible rule that an unparseable disruption is never rendered as a blackout and
  never as an all-clear.

### 7. Time-driven theme

The existing `at` value (the queried datetime, Melbourne timezone) selects a token set:
day, dusk, or night. Day keeps the current cream paper — matte and flat. Night is deep
ink with lines rendered as emitted light via an SVG glow filter and stations as bright
pips. The same scrubber already in `TimeBar` drives the transition, so the aesthetic
answers to the app's core interaction instead of a bolted-on toggle.

Themes crossfade by animating CSS custom properties on a wrapper element. Under
`prefers-reduced-motion: reduce` the crossfade and all pulses are dropped, states change
instantly.

Line hues stay at their official values in both themes (`#F581B6`, `#00A2E2`, `#F6BE00`,
`#CC132E`, `#004B99`, `#00953C`, `#4CB05C`); only canvas, ink and effects change.

### 8. API

`StatusResponse` gains a `stations` array alongside `segments`:

```ts
export interface StationStatus {
  stationId: string;
  status: "normal" | "boundary" | "cut" | "warning";
  disruptionIds: string[];
  lines: { lineId: LineId; status: StationStatus["status"] }[];
}
```

The per-line breakdown is required because interchanges serve several lines: Richmond can
be `cut` on Frankston and `normal` on Lilydale in the same moment, and the detail sheet
must say so.

Computed in `lib/status.ts` from the same disruption set as `segments`, reusing
`stationInSection`. No new data source and no change to the scraper.

### 9. Detail sheet

Selecting a station shows: station name, then each line it serves with that line's own
status, then the relevant `DisruptionCard`s, then a "See the month" link that opens the
Calendar tab for that station. The two tabs currently share no navigation; this connects
them.

Selecting an edge keeps today's content — line, segment endpoints, status, cards.

## Non-goals

- Redrawing the network with hand-authored coordinates for all 225 stations. Only the
  ~12 CBD nodes are hand-placed.
- Regional lines. The network model covers the 16 metro lines and that does not change.
- Any change to scraping, parsing, or the merge logic in `lib/spans.ts`.
- A manual light/dark toggle. Theme follows queried time; that is the whole idea.

## Testing

- Endpoint-proximity test over all 289 edges (guards the CBD repair).
- Label-placement test: no two shown labels overlap at the default zoom for any focused
  line.
- `computeStatus` unit tests for the three station states, including the boundary case at
  both ends of a section and an interchange that is cut on one line only.
- Existing `tests/parse.test.ts` fixtures are untouched.

## Risks

- **Label placement is the least certain part.** Automatic scoring may produce a dozen
  awkward positions; the manual override block is the escape hatch, and the work is
  bounded because only focused-line and interchange labels show at default zoom.
- **Hand-placed CBD coordinates must match the extracted map's scale.** They are authored
  in the same 3572 × 2526 pixel space, and the proximity test catches drift.
- **Glow filters can be slow on low-end phones.** The night theme's glow is a single
  `feGaussianBlur` applied to one grouped layer, not per-path, and is dropped entirely
  under reduced-motion.
