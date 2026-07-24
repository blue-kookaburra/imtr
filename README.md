# Is My Train Running?

Melbourne train disruptions without the confusion. Two tabs:

- **Map** — schematic network map; segments with no service are blacked out (red hazard dashes = bus replacement, dimmed = outside timetabled hours). Defaults to now; pick any future date/time.
- **Calendar** — pick a station, see a colour-coded month of disruptions (green normal, amber part-of-day, red buses/closed, grey beyond the four-week forecast).

## How data flows

1. `npm run scrape` (GitHub Actions, every 2 days) pulls the [planned works pages](https://transport.vic.gov.au/plan-a-journey/planned-works) via **curl** — the site's bot protection blocks node/serverless TLS fingerprints — parses the four-week forecast tables and commits `data/disruptions.json`.
2. The Next.js app bundles that JSON. `/api/status?at=` merges it with baseline service spans (first/last train per day, Night Network Fri/Sat) into per-segment statuses. `/api/station/<id>/calendar` produces per-day station statuses.
3. Optional: set `PTV_DEV_ID` + `PTV_API_KEY` env vars to overlay live/unplanned disruptions from the PTV Timetable API v3. The app fully works without them.

**Fail-visible principle:** anything the parser can't confidently map to track segments renders as a line-level warning, never as a wrong blackout and never as a false "all clear".

## Develop

```bash
npm install
npm run scrape   # refresh data/disruptions.json (needs curl)
npm run dev
npm test         # parser fixtures + merge logic
```

## Deploy

Push to GitHub, import into Vercel (defaults are fine). The scrape workflow (`.github/workflows/scrape.yml`) commits refreshed data every 2 days, which triggers a redeploy.

Design spec: `docs/superpowers/specs/2026-07-25-is-my-train-running-design.md`.
