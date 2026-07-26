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
npm run scrape       # refresh data/disruptions.json (needs curl on PATH)
python scripts/extract_map.py   # regenerate map raster + station/edge coords from docs/official-map.pdf
```

Deploy: push to `main` (repo github.com/blue-kookaburra/imtr, connected to Vercel project `imtr`), or `npx vercel --prod --yes`. Live at https://imtr-blue-kookaburras-projects.vercel.app.

## Critical constraints (learned the hard way)

- **transport.vic.gov.au fingerprints TLS.** Node fetch gets 403 even with full browser headers; plain `curl` passes. All scraping therefore happens in GitHub Actions (`.github/workflows/scrape.yml`, every 2 days) via `scripts/scrape.ts`, which shells out to curl and commits `data/disruptions.json`. Never move scraping into Next.js runtime/serverless — it will 403 on Vercel.
- **The official map PDF has no text layer.** `scripts/extract_map.py` OCRs station labels (Tesseract at `C:\Program Files\Tesseract-OCR`), snaps them to colour-matched vector paths, and Dijkstra-routes every edge along the drawn artwork. Rerun only when a new map edition lands in `docs/official-map.pdf`.
- **Fail-visible principle.** Anything the parser can't confidently map to track segments renders as a line-level ⚠ warning — never a possibly-wrong blackout, never a false "all clear". Preserve this in any parser/merge change.

## Data flow

1. **Scrape (CI):** `scripts/scrape.ts` fetches the planned-works index → each line page → each linked disruption **article page**. Line pages hold four-week forecast tables (dates only, in embedded `__NEXT_DATA__` JSON); article pages hold machine-readable `FromDate`/`ToDate` timestamps ("buses from 9:30pm"). Article-derived disruptions supersede overlapping table rows. Parsing lives in `lib/scrape/parse.ts` — station-section extraction ("between X, Y and Z"), nightly-window handling ("each night" → daily time window, not continuous span), City Loop aliases, and a title-date fallback for bad CMS dates.
2. **Merge (runtime):** `lib/status.ts` computes per-segment status at a moment: baseline service spans (`lib/spans.ts`: first/last train per day, Night Network Fri/Sat) → overlay scraped disruptions → overlay optional PTV API live records (`lib/ptv.ts`; only active when `PTV_DEV_ID`/`PTV_API_KEY` env vars set — app fully works without). Precise timestamps (`startTs`/`endTs`) beat date+daily-window when present. Statuses: `running | no-service | bus-replacement | warning`.
3. **API:** `app/api/status/route.ts` (`?at=` datetime → map segments) and `app/api/station/[id]/calendar/route.ts` (per-day station statuses; days beyond the ~4-week forecast horizon are `no-data`, deliberately distinct from `normal`).

## Network model

`lib/network/data.ts` defines the 16 metro lines as ordered station-id lists (single source of truth — the scraper's station-name matching, merge spans, and map edges all key off it). `lib/network/build.ts` derives stations/edges; edge ids look like `werribee:newport-seaholme`. The Metro Tunnel core (Footscray→Arden→…→Anzac→Caulfield) is shared by sunbury/pakenham/cranbourne line defs. `ANCHORS`/`ARMS` schematic coords in data.ts are legacy (superseded by the raster map) but `extract_map.py` still parses this file's LINES arrays — keep station arrays intact.

Map rendering (`components/NetworkMap.tsx`): `public/network-map.png` raster + SVG overlays whose geometry comes from `data/map-stations.json` (`stations` = label-snapped coords, `edges` = per-edge polylines routed along the artwork). Overlays wash out the printed line colour, then draw status strokes; invisible fat paths are the tap targets.

## Conventions

- Timezone: everything user-facing is Australia/Melbourne (`lib/meltz.ts`, `lib/spans.ts` helpers). Never use raw `toISOString().slice(0,10)` for a user-facing "today".
- Tests (`tests/parse.test.ts`) run against saved real HTML fixtures in `tests/fixtures/` — when the parser changes, extend fixtures rather than mocking.
- Theme: light "paper" tokens in `app/globals.css` (`--bg`, `--ink`, `--accent`…), matching the official map. Fonts: Overpass / Overpass Mono via `next/font`.
- When the official text of a disruption already states times, show only that text — feed timestamps include padding buffers and read as contradictions (`components/DisruptionCard.tsx`).
