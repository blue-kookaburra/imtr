// Scrapes transport.vic.gov.au planned-works pages via curl (the site's
// bot protection blocks node's fetch by TLS fingerprint, but allows curl)
// and writes data/disruptions.json. Run by GitHub Actions every 2 days:
//   npm run scrape
import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { extractArticleUrls, parseArticle, parsePage } from "../lib/scrape/parse";
import type { Disruption } from "../lib/types";

const BASE = "https://transport.vic.gov.au";
const INDEX_URL = `${BASE}/plan-a-journey/planned-works`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function curl(url: string, attempts = 3): string | null {
  for (let i = 0; i < attempts; i++) {
    try {
      return execFileSync("curl", ["-sfL", "--max-time", "30", "-A", UA, url], {
        encoding: "utf-8",
        maxBuffer: 20 * 1024 * 1024,
      });
    } catch {
      if (i < attempts - 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    }
  }
  return null;
}

const indexHtml = curl(INDEX_URL);
if (!indexHtml) {
  console.error("FATAL: could not fetch planned-works index page");
  process.exit(1);
}

const urls = new Set<string>();
const re =
  /href="(?:https:\/\/transport\.vic\.gov\.au)?(\/plan-a-journey\/planned-works\/[a-z0-9-]*disruptions[a-z0-9-]*)"/g;
let m: RegExpExecArray | null;
while ((m = re.exec(indexHtml))) urls.add(BASE + m[1]);
console.log(`Found ${urls.size} line pages`);
if (urls.size === 0) {
  console.error("FATAL: no line pages discovered — page structure may have changed");
  process.exit(1);
}

const now = new Date();
const tableRows = new Map<string, Disruption>();
const articleUrls = new Set<string>();
let ok = 0;
for (const url of urls) {
  const html = curl(url);
  if (!html) {
    console.warn(`WARN: failed to fetch ${url}`);
    continue;
  }
  const parsed = parsePage(html, now, url);
  for (const a of extractArticleUrls(html)) articleUrls.add(a);
  console.log(`${url.split("/").pop()}: ${parsed.length} table rows`);
  for (const d of parsed) tableRows.set(d.id, d);
  ok++;
}

if (ok === 0) {
  console.error("FATAL: all line pages failed to fetch");
  process.exit(1);
}

// Article pages carry exact start/end timestamps the tables lack.
const articles: Disruption[] = [];
for (const aUrl of articleUrls) {
  const html = curl(aUrl);
  if (!html) {
    console.warn(`WARN: failed to fetch article ${aUrl}`);
    continue;
  }
  const d = parseArticle(html, aUrl);
  if (d) {
    articles.push(d);
    console.log(`article ${aUrl.split("/").pop()!.slice(0, 60)}…: ok`);
  }
}

// A table row is redundant when an article covers the same lines and dates.
const kept = [...tableRows.values()].filter(
  (row) =>
    !articles.some(
      (a) =>
        a.startDate <= row.endDate &&
        a.endDate >= row.startDate &&
        row.lineIds.every((id) => a.lineIds.includes(id))
    )
);

const out = {
  disruptions: [...articles, ...kept],
  fetchedAt: now.toISOString(),
  pagesTried: urls.size,
  pagesOk: ok,
};
mkdirSync(join(process.cwd(), "data"), { recursive: true });
writeFileSync(join(process.cwd(), "data", "disruptions.json"), JSON.stringify(out, null, 2));
console.log(`Wrote data/disruptions.json: ${out.disruptions.length} disruptions from ${ok}/${urls.size} pages`);
