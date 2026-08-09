<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Is My Train Running?

Mobile-first PWA answering one question for Melbourne train users: is my train running at a given date and time? Two tabs: **Map** (official network map with disruption overlays, "now" or any future time) and **Calendar** (per-station month grid of disruptions). Design spec: `docs/superpowers/specs/2026-07-25-is-my-train-running-design.md`.

## Commands

```bash
npm run dev          # dev server
npm run build        # production build (Turbopack)
npm test             # vitest run — all tests
npx vitest run tests/parse.test.ts -t "article"   # single test by name filter
npm run scrape       # refresh data/disruptions.json (needs curl on PATH; 403s from non-residential IPs — see Critical constraints)
powershell -File scripts\scrape-local.ps1   # scrape + test + commit + push, what the scheduled task runs
python scripts/extract_map.py   # regenerate docs/network-map.png + station/edge coords from docs/official-map.pdf
npm run map:build    # rebuild data/map-geometry.json from extracted coords + hand overrides
npm run brand:build  # rebuild the logo mark + every app icon from docs/brand/
```

Deploy: push to `main` (repo github.com/blue-kookaburra/imtr, connected to Vercel project `imtr`), or `npx vercel --prod --yes`. Live at https://imtr-blue-kookaburras-projects.vercel.app.

## Critical constraints (learned the hard way)

- **transport.vic.gov.au fingerprints TLS *and* blocks cloud/CI IP ranges.** Node fetch gets 403 even with full browser headers; plain `curl` passes — but only from a residential IP. Vercel's IPs 403; as of 2026-08-01 GitHub Actions' shared-runner IPs started 403ing too (Cloudflare tightening cloud-IP reputation, confirmed via `workflow_dispatch` with curl's real error surfaced). Scraping therefore runs from a **local Windows Scheduled Task** (`scripts/scrape-local.ps1`, registered by `scripts/register-scrape-task.ps1`, every 2 days) via `scripts/scrape.ts`, which shells out to curl and commits+pushes `data/disruptions.json`. `.github/workflows/scrape.yml` is kept as `workflow_dispatch`-only in case the block ever lifts — never re-enable its cron or move scraping into Next.js runtime/serverless without testing from that host's actual egress IP first.
- **The official map PDF has no text layer.** `scripts/extract_map.py` OCRs station labels (Tesseract at `C:\Program Files\Tesseract-OCR`), snaps them to colour-matched vector paths, and Dijkstra-routes every edge along the drawn artwork. Rerun only when a new map edition lands in `docs/official-map.pdf`.
- **Fail-visible principle.** Anything the parser can't confidently map to track segments renders as a line-level ⚠ warning — never a possibly-wrong blackout, never a false "all clear". Preserve this in any parser/merge change.
- **The logo lives in `docs/brand/`, and everything shipped from it is generated.** `train-mark-outline.svg` is an Illustrator export holding **two** stacked copies of the mark — outline-only and white-filled — with a viewBox that frames the first and leaves the second off-canvas. `scripts/build_brand.ts` finds the outline copy by rendering each element and keeping the upper band, then writes `components/brand/mark.ts`, `public/icon*.png|svg`, `public/apple-touch-icon.png` and `app/favicon.ico`. Never hand-edit those; replace the export and rerun `npm run brand:build`. The mark is fine line art and greys out below ~32px, so `components/Logo.tsx` is used at `h-8` and no smaller, and the 32px favicon is cropped tighter than the other tiles.
- **`data/map-geometry.json` is generated — never hand-edit it.** Fix geometry in `data/map-overrides.json` or the scoring in `scripts/build_map_geometry.ts`, then rerun `npm run map:build`. `tests/map-geometry.test.ts` fails if the build had to drag any polyline more than 25 px to reach its station — a long reach means the edge was routed somewhere else entirely and needs a hand-authored polyline, not a snap.

## Data flow

1. **Scrape (CI):** `scripts/scrape.ts` fetches the planned-works index → each line page → each linked disruption **article page**. Line pages hold four-week forecast tables (dates only, in embedded `__NEXT_DATA__` JSON); article pages hold machine-readable `FromDate`/`ToDate` timestamps ("buses from 9:30pm"). Article-derived disruptions supersede overlapping table rows. Parsing lives in `lib/scrape/parse.ts` — station-section extraction ("between X, Y and Z"), nightly-window handling ("each night" → daily time window, not continuous span), loop closure detection via `loopSkippedStations` (closure phrase yields the three underground ring stations — Flagstaff, Melbourne Central, Parliament — all or nothing), and a title-date fallback for bad CMS dates.
2. **Merge (runtime):** `lib/status.ts` computes per-segment status at a moment: baseline service spans (`lib/spans.ts`: first/last train per day, Night Network Fri/Sat) → overlay scraped disruptions → overlay optional PTV API live records (`lib/ptv.ts`; only active when `PTV_DEV_ID`/`PTV_API_KEY` env vars set — app fully works without). Precise timestamps (`startTs`/`endTs`) beat date+daily-window when present. Statuses: `running | no-service | bus-replacement | warning`.
3. **API:** `app/api/status/route.ts` (`?at=` datetime → map segments) and `app/api/station/[id]/calendar/route.ts` (per-day station statuses; days beyond the ~4-week forecast horizon are `no-data`, deliberately distinct from `normal`).

## Network model

`lib/network/data.ts` defines the 16 metro lines as ordered station-id lists (single source of truth — the scraper's station-name matching, merge spans, and map edges all key off it). `lib/network/build.ts` derives stations/edges; edge ids look like `werribee:newport-seaholme`. The Metro Tunnel core (Footscray→Arden→…→Anzac→Caulfield) is shared by sunbury/pakenham/cranbourne line defs. `ANCHORS`/`ARMS` schematic coords in data.ts are legacy (superseded by `data/map-geometry.json`) but `extract_map.py` still parses this file's LINES arrays — keep station arrays intact.

Map rendering (`components/NetworkMap.tsx` + `components/map/*`): pure SVG drawn from `data/map-geometry.json`, generated by `npm run map:build` from the OCR-extracted `data/map-stations.json` plus hand-authored `data/map-overrides.json`. The build snaps parallel-lane endpoints onto their stations, simplifies polylines, and precomputes label placement. Station dots are the primary tap target; line strokes are secondary. Five station states — `normal`, `no-service` (asleep, never a fault), `boundary` (trains terminate here), `cut`, `warning` — plus a separate non-maskable `unmapped` flag per the fail-visible principle. The canvas theme follows the queried time via `lib/map/theme.ts`.

The City Loop is an overlay (`LOOP` in `lib/network/data.ts`): a ring of five city stations plus, per colour group, the order its trains call at them and the trunk station its ring rejoins. `build.ts` derives loop stations and per-line ring edges from it. The 16 `LINES` arrays deliberately do NOT contain loop stations — `extract_map.py`, the geometry build and the scraper's station matching all key off those arrays. There are three separate notions of order: the `LINES` arrays (drawn trunk), `matchSequence(lineId)` (which stations a disruption section covers, ring spliced in), and `data/map-geometry.json` (the polylines actually drawn).

City Loop closures are modelled as disruptions with `skipsStations?: string[]` — exactly those stations lose service while the line otherwise runs. Flinders Street and Southern Cross are never skipped (they are the surface route every train uses whether via the loop or not); only Flagstaff, Melbourne Central and Parliament can be. `lib/status.ts` handles these directly rather than through `lineSpan`. Ring geometry is regenerated from a new poster edition with `python scripts/trace_loop_ring.py | npx tsx scripts/expand_loop_lanes.ts` followed by `npm run map:build`. The old raster lives at `docs/network-map.png` for eyeballing new map editions only — nothing ships it.

## Conventions

- Timezone: everything user-facing is Australia/Melbourne (`lib/meltz.ts`, `lib/spans.ts` helpers). Never use raw `toISOString().slice(0,10)` for a user-facing "today".
- Tests (`tests/parse.test.ts`) run against saved real HTML fixtures in `tests/fixtures/` — when the parser changes, extend fixtures rather than mocking.
- Theme: light "paper" tokens in `app/globals.css` (`--bg`, `--ink`, `--accent`…), matching the official map. Fonts: Overpass / Overpass Mono via `next/font`.
- When the official text of a disruption already states times, show only that text — feed timestamps include padding buffers and read as contradictions (`components/DisruptionCard.tsx`).
