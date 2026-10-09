import type { Disruption } from "./types";
import { fetchLiveDisruptions } from "./ptv";
import { supersedes } from "./supersede";
import snapshot from "@/data/disruptions.json";

// Planned works come from data/disruptions.json, refreshed every 2 days by a
// local Scheduled Task running `npm run scrape` (the source site's bot
// protection blocks serverless and CI fetches, so it runs from a residential
// IP with curl — see AGENTS.md).

export interface DisruptionData {
  disruptions: Disruption[];
  dataUpdatedAt: string;
  // Last date covered by the four-week forecast (approx: scrape date + 28d).
  horizonEnd: string;
}

export async function getDisruptionData(): Promise<DisruptionData> {
  const scraped = snapshot as { disruptions: Disruption[]; fetchedAt: string };
  const live = await fetchLiveDisruptions(); // [] when unconfigured/down
  // A live record has exact timestamps; the scraped row only has whole dates.
  const kept = scraped.disruptions.filter((d) => !live.some((l) => supersedes(l, d)));
  const horizon = new Date(new Date(scraped.fetchedAt).getTime() + 28 * 24 * 3600 * 1000);
  return {
    disruptions: [...kept, ...live],
    dataUpdatedAt: scraped.fetchedAt,
    horizonEnd: horizon.toISOString().slice(0, 10),
  };
}
