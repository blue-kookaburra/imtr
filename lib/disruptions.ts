import { unstable_cache } from "next/cache";
import type { Disruption } from "./types";
import { scrapeAll, SCRAPE_REVALIDATE_SECONDS } from "./scrape/fetch";
import { fetchLiveDisruptions } from "./ptv";

// Planned works scrape, cached for 2 days (per-page fetches are also cached
// with the same revalidate window, so a cold cache miss stays cheap).
const getPlannedWorks = unstable_cache(
  async () => scrapeAll(new Date()),
  ["planned-works"],
  { revalidate: SCRAPE_REVALIDATE_SECONDS }
);

export interface DisruptionData {
  disruptions: Disruption[];
  dataUpdatedAt: string;
  // Last date covered by the four-week forecast (approx: scrape date + 28d).
  horizonEnd: string;
}

export async function getDisruptionData(): Promise<DisruptionData> {
  const scraped = await getPlannedWorks();
  const live = await fetchLiveDisruptions(); // [] when unconfigured/down
  const horizon = new Date(new Date(scraped.fetchedAt).getTime() + 28 * 24 * 3600 * 1000);
  return {
    disruptions: [...scraped.disruptions, ...live],
    dataUpdatedAt: scraped.fetchedAt,
    horizonEnd: horizon.toISOString().slice(0, 10),
  };
}
