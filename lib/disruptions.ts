import type { Disruption } from "./types";
import { fetchLiveDisruptions } from "./ptv";
import snapshot from "@/data/disruptions.json";

// Planned works come from data/disruptions.json, refreshed every 2 days by a
// GitHub Actions cron running `npm run scrape` (the source site's bot
// protection blocks serverless fetches, so scraping happens in CI with curl).

export interface DisruptionData {
  disruptions: Disruption[];
  dataUpdatedAt: string;
  // Last date covered by the four-week forecast (approx: scrape date + 28d).
  horizonEnd: string;
}

// A PTV API record supersedes a scraped planned-works row when they cover
// the same lines and overlapping dates — the API one has exact timestamps
// ("buses from 9:30pm"), the scraped table only has whole dates.
function supersededByLive(scrapedD: Disruption, live: Disruption[]): boolean {
  return live.some(
    (l) =>
      l.startDate <= scrapedD.endDate &&
      l.endDate >= scrapedD.startDate &&
      scrapedD.lineIds.every((id) => l.lineIds.includes(id))
  );
}

export async function getDisruptionData(): Promise<DisruptionData> {
  const scraped = snapshot as { disruptions: Disruption[]; fetchedAt: string };
  const live = await fetchLiveDisruptions(); // [] when unconfigured/down
  const kept = scraped.disruptions.filter((d) => !supersededByLive(d, live));
  const horizon = new Date(new Date(scraped.fetchedAt).getTime() + 28 * 24 * 3600 * 1000);
  return {
    disruptions: [...kept, ...live],
    dataUpdatedAt: scraped.fetchedAt,
    horizonEnd: horizon.toISOString().slice(0, 10),
  };
}
