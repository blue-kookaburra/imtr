# Is My Train Running — Design Spec

**Date:** 2026-07-25
**Status:** Approved

## Purpose

Mobile-optimised web app answering one question for Melbourne train users: *is my train running at a given date and time?* Cuts through confusing PTV/Metro bus-replacement notifications. Public app, anyone in Melbourne.

## Product shape

Two tabs:

1. **Map** — schematic map of the metro train network. Segments with no service are blacked out (e.g. Werribee line terminating at Newport → Newport–Werribee blacked out). Defaults to "now"; date/time picker at top shows status at any future time. Baseline timetable knowledge means 4am Thursday shows lines blacked out when genuinely no trains run. Zoom/pan supported.
2. **Calendar** — pick a station, see a month-grid calendar with colour-coded days showing disruptions (e.g. Yarraville: amber day = buses only after 8:20pm).

## Architecture

**Stack:** Next.js (App Router) + TypeScript + Tailwind, hosted on Vercel (Sydney region). PWA basics (manifest, offline cache of last-known status).

### Data sources (layered)

1. **Planned-works scraper (primary — no API key needed).** Vercel cron every 2 days fetches transport.vic.gov.au planned-works pages with a browser user-agent. Data lives in each page's embedded `__NEXT_DATA__` JSON as HTML tables ("This week" + "Four-week forecast" weekly accordions). Row format: `Werribee Line | Monday 13 July to Thursday 16 July | Buses replace trains from Newport to Werribee`. The index page `/plan-a-journey/planned-works` is scraped for per-line page URLs so new pages are picked up automatically. Parsed output cached as JSON (Vercel KV/Blob).
2. **PTV Timetable API v3 (optional enrichment).** Live/unplanned disruptions only. App fully functions without it; when a key is configured it adds "right now" accuracy. Graceful degrade if absent or down.
3. **GTFS static.** Station list, line topology, service spans (first/last train per station per day-of-week). Answers "4am Thursday = no trains". Build-time script, refreshed weekly.

### Disruption parser

Input: scraped table rows (and PTV API records when available). Output: normalized segments `{lineId, fromStation, toStation, dateRange, timeWindow, type}`. Structured fields first; "between/from X to/and Y" station-name matching against the station list; time qualifiers ("after 8:20pm", "until last service"). Unparseable rows → whole-line ⚠ warning, never a wrong blackout and never a false "all clear".

### Merge logic

Status at time T per segment = baseline service-span check → overlay scraped planned works → overlay live API disruptions (if configured). Statuses: `running | no-service | bus-replacement | warning`.

### App API

- `GET /api/status?at=<datetime>` → per-line segment statuses for the map
- `GET /api/station/<id>/calendar?from=&to=` → per-day status for the calendar

## Map tab

- Hand-built schematic SVG in familiar PTV style: official line colours, City Loop as loop, 45° schematic geometry. Own artwork (no copyright issue).
- Data-driven: stations + edges defined in one topology JSON (shared with backend); SVG generated from it. Segment paths id'd like `werribee:newport-seaholme`.
- Blackout: affected segments dark grey/black with dashed overlay; bus-replacement segments show a bus icon; unparseable → line-level ⚠ badge.
- Zoom/pan via small custom hook (pinch, wheel, drag). Label density scale-aware.
- Time control: "Now" pill + native `datetime-local` picker (min = now). Future selection re-renders map, banner "Showing Sat 26 Jul, 10:00pm" with reset.
- Tap segment/station → bottom sheet with disruption detail text.

## Calendar tab

- Station search with client-side fuzzy autocomplete (~220 stations); recents in localStorage; station in URL (`/calendar?station=yarraville`).
- Month grid, swipe/arrows between months, range = current month → +2 months.
- Day colours: **green** normal · **amber** partial (time-windowed, or elsewhere-on-line) · **red** full-day replacement/no trains · **grey** beyond data horizon ("no data yet" ≠ "no disruptions").
- Tap day → bottom sheet with time-windowed detail + link to Map tab pre-set to that date.

## Error handling

- Stale scrape (>3 days) → "Data last updated X" banner.
- PTV API down → silent degrade to planned-works only.
- Parse failure → line-level ⚠. **Fail-visible principle: uncertainty is shown as warning, never as green.**
- Scraper fragility: schema-validate parse output; on failure alert + serve stale cache.

## Testing

- Parser unit tests against saved real HTML fixtures.
- Merge-logic unit tests (disruption × service-span combinations).
- Playwright smoke tests for both tabs.

## Implementation notes

- UI built using `ui-ux-pro-max` and `impeccable` skills — elite design bar.
- Scrape cron: every 2 days.
