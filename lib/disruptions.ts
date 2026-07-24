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

export async function getDisruptionData(): Promise<DisruptionData> {
  const scraped = snapshot as { disruptions: Disruption[]; fetchedAt: string };
  const live = await fetchLiveDisruptions(); // [] when unconfigured/down
  const horizon = new Date(new Date(scraped.fetchedAt).getTime() + 28 * 24 * 3600 * 1000);
  return {
    disruptions: [...scraped.disruptions, ...live],
    dataUpdatedAt: scraped.fetchedAt,
    horizonEnd: horizon.toISOString().slice(0, 10),
  };
}
