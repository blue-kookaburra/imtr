import type { Disruption } from "../types";
import { parsePage } from "./parse";

const BASE = "https://transport.vic.gov.au";
const INDEX_URL = `${BASE}/plan-a-journey/planned-works`;

// The site 403s default fetch agents; a browser UA is required.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Scrape refresh interval: every 2 days.
export const SCRAPE_REVALIDATE_SECONDS = 172800;

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      next: { revalidate: SCRAPE_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Line disruption page URLs discovered from the index page, so newly added
// lines are picked up automatically.
export async function discoverLinePages(): Promise<string[]> {
  const html = await fetchPage(INDEX_URL);
  if (!html) return [];
  const urls = new Set<string>();
  const re = /href="(?:https:\/\/transport\.vic\.gov\.au)?(\/plan-a-journey\/planned-works\/[a-z0-9-]*disruptions[a-z0-9-]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) urls.add(BASE + m[1]);
  return [...urls];
}

export interface ScrapeResult {
  disruptions: Disruption[];
  fetchedAt: string;
  pagesTried: number;
  pagesOk: number;
}

export async function scrapeAll(now = new Date()): Promise<ScrapeResult> {
  const pages = await discoverLinePages();
  const results = await Promise.all(pages.map((u) => fetchPage(u)));
  const disruptions = new Map<string, Disruption>();
  let ok = 0;
  for (const html of results) {
    if (!html) continue;
    ok++;
    for (const d of parsePage(html, now)) disruptions.set(d.id, d);
  }
  return {
    disruptions: [...disruptions.values()],
    fetchedAt: now.toISOString(),
    pagesTried: pages.length,
    pagesOk: ok,
  };
}
