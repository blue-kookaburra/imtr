import type { Disruption, LineId } from "../types";
import { LINES, LOOP } from "../network/data";
import { findStationId } from "../network/build";
import { melbourneDateOf, melbourneLocalToIso } from "../meltz";

// Parses transport.vic.gov.au planned-works pages. The page is a Next.js
// app whose disruption tables live in the embedded __NEXT_DATA__ JSON as
// HTML strings ("This week" table + weekly "Four-week forecast" accordions).

export function extractTableHtml(pageHtml: string): string[] {
  const m = pageHtml.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const tables: string[] = [];
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) {
      o.forEach(walk);
    } else if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        if (
          (k === "Text" || k === "Content") &&
          v &&
          typeof v === "object" &&
          "value" in v &&
          typeof (v as { value: unknown }).value === "string" &&
          (v as { value: string }).value.includes("<table")
        ) {
          tables.push((v as { value: string }).value);
        } else {
          walk(v);
        }
      }
    }
  };
  walk(data);
  return tables;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;| | /g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Rows of visible text per <tr>.
export function tableRows(tableHtml: string): string[] {
  const rows: string[] = [];
  const trRe = /<tr[\s\S]*?<\/tr>/g;
  for (const tr of tableHtml.match(trRe) ?? []) {
    const text = decodeEntities(tr.replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (text) rows.push(text);
  }
  return rows;
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function parseDayMonth(s: string, refDate: Date): string | null {
  const m = s.match(/(\d{1,2})\s+([A-Za-z]+)/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month === -1 || day < 1 || day > 31) return null;
  // No year on the page: pick the year that lands nearest the scrape date.
  const refYear = refDate.getFullYear();
  let best: Date | null = null;
  for (const y of [refYear - 1, refYear, refYear + 1]) {
    const d = new Date(Date.UTC(y, month, day));
    if (!best || Math.abs(d.getTime() - refDate.getTime()) < Math.abs(best.getTime() - refDate.getTime())) {
      best = d;
    }
  }
  return best!.toISOString().slice(0, 10);
}

// "8.20pm", "8:20pm", "8pm", "10am" -> minutes from midnight.
function parseClock(s: string): number | null {
  const m = s.match(/(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  return h * 60 + (m[2] ? parseInt(m[2], 10) : 0);
}

// Match line mentions like "Werribee Line", "Belgrave, Lilydale and Alamein lines".
function matchLines(text: string): LineId[] {
  const found: LineId[] = [];
  const lower = text.toLowerCase();
  for (const line of LINES) {
    const name = line.name.toLowerCase();
    // Station and line names collide (e.g. "Werribee"), so require list or
    // "line(s)" context around the name.
    const re = new RegExp(`\\b${name}\\s*(,|\\band\\b|lines?\\b|passengers?\\b)`, "i");
    if (re.test(lower) || lower.includes(`${name} line`)) {
      found.push(line.id);
    }
  }
  return found;
}

function resolveStation(name: string): string | undefined {
  return findStationId(name.trim().toLowerCase());
}

// Melbourne CMS boilerplate for "the line runs, the ring does not". Requires a
// loop-specific phrase: a bare "to Flinders Street" is how half of all
// disruption text ends and must not fire this.
const LOOP_CLOSED =
  /\b(?:run(?:ning|s)?\s+direct\s+to\s+flinders\s+street|not\s+(?:run\s+)?via\s+the\s+city\s+loop|bypass(?:ing|es)?\s+the\s+city\s+loop|not\s+stop\s+at\s+flagstaff)/i;

// Flinders Street is included so every affected line's match sequence has two
// endpoints to span between; the three ring-only stations are the payload.
const LOOP_SECTION = ["flinders-street", ...LOOP.ring.filter((s) => s !== "flinders-street" && s !== "southern-cross")];

// "between North Melbourne, Newport and Williamstown" /
// "from Newport to Werribee" / "between Parliament, Alamein and Box Hill".
// Returns every station mentioned so multi-branch sections can be spanned
// per line downstream.
export function sectionStations(text: string): string[] | null {
  const m = text.match(
    /(?:between|from)\s+([A-Za-z',\/ ]+?)(?:\.|,?\s+(?:each|nightly|daily|after|until|while|due|stations|when|what|why)\b|\s+\d|$)/i
  );
  if (m) {
    const parts = m[1].split(/,|\/|\band\b|\bto\b/i);
    const ids = [...new Set(parts.map(resolveStation).filter((s): s is string => !!s))];
    if (ids.length >= 2) return ids;
  }
  // No explicit section, but the text says the ring is shut.
  if (LOOP_CLOSED.test(text)) return [...LOOP_SECTION];
  return null;
}

function matchTimeWindow(text: string): { startMin?: number; endMin?: number } {
  const lower = text.toLowerCase();
  let startMin: number | undefined;
  let endMin: number | undefined;
  const after = lower.match(/(?:after|from)\s+(\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm))/);
  if (after) startMin = parseClock(after[1]) ?? undefined;
  const until = lower.match(/(?:until|before|to)\s+(\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm))/);
  if (until) endMin = parseClock(until[1]) ?? undefined;
  // "Buses replace evening trains" with no explicit time: assume from ~6pm.
  if (startMin === undefined && endMin === undefined && /evening trains/.test(lower)) {
    startMin = 18 * 60;
  }
  return { startMin, endMin };
}

function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "d" + (h >>> 0).toString(36);
}

const DISRUPTION_KEYWORDS =
  /buses replace|bus replacement|no trains|trains (?:do )?not run|closed|coaches replace|service(?:s)? (?:will )?not run/i;

// Article page URLs linked from a planned-works line page. These per-
// disruption pages carry exact start/end timestamps the tables lack.
export function extractArticleUrls(pageHtml: string): string[] {
  const urls = new Set<string>();
  const re = /disruptions-information\/article\/([a-z0-9-]{10,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pageHtml))) {
    urls.add(`https://transport.vic.gov.au/disruptions/disruptions-information/article/${m[1]}`);
  }
  return [...urls];
}

interface ArticleDisruption {
  ID: number;
  Title: string;
  ArticleTitle: string;
  SubtitleMessage: string;
  FromDate: string; // "2026-07-25 21:00:00" Melbourne local
  ToDate: string;
  Article: string; // HTML body
  Lines: Record<string, { Line: string }> | null;
}

// Parse a disruption article page into a timestamped Disruption.
// Returns null for articles that don't describe a service gap (e.g. pure
// timetable-change notices).
export function parseArticle(pageHtml: string, articleUrl: string, refDate = new Date()): Disruption | null {
  const m = pageHtml.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let a: ArticleDisruption;
  try {
    a = JSON.parse(m[1])?.props?.pageProps?.disruption;
  } catch {
    return null;
  }
  if (!a || !a.FromDate || !a.ToDate) return null;

  const plainArticle = decodeEntities(a.Article ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const allText = `${a.ArticleTitle ?? ""} ${a.SubtitleMessage ?? ""} ${plainArticle}`;

  const SERVICE_GAP =
    /buses replace|bus replacement|no trains|trains (?:do )?not run|coaches replace|closed|start and end at/i;
  if (!SERVICE_GAP.test(allText)) return null;

  // Lines from the structured Lines map, falling back to name-matching.
  const lineNames = Object.values(a.Lines ?? {}).map((l) => l.Line.toLowerCase());
  let lineIds = LINES.filter((l) => lineNames.includes(l.name.toLowerCase())).map((l) => l.id);
  if (lineIds.length === 0) lineIds = matchLines(allText);
  if (lineIds.length === 0) return null;

  // Affected section: "between X(, Y) and Z" / "from X to Z", or
  // "trains start and end at X" => the city end up to X is out.
  let stations = sectionStations(allText);
  if (!stations) {
    const se = allText.match(/start and end at ([A-Za-z' ]+?)(?:[.,]|$| from| between)/i);
    if (se) {
      const s = findStationId(se[1]);
      if (s && s !== "flinders-street") stations = ["flinders-street", s];
    }
  }

  const startTs = melbourneLocalToIso(a.FromDate);
  const endTs = melbourneLocalToIso(a.ToDate);
  const summary = a.ArticleTitle?.includes(":")
    ? a.ArticleTitle.slice(a.ArticleTitle.indexOf(":") + 1).trim()
    : (a.ArticleTitle ?? a.SubtitleMessage);

  const base = {
    id: `art-${a.ID}`,
    lineIds,
    fromStation: stations?.[0],
    toStation: stations?.[stations.length - 1],
    stations: stations ?? undefined,
    wholeLine: !stations,
    // No section found: confident whole-line only when the title doesn't
    // hint at a station section we failed to parse.
    parsed: !!stations || !/between/i.test(`${a.ArticleTitle ?? ""} ${a.SubtitleMessage ?? ""}`),
    rawText: summary,
    source: "planned-works" as const,
    url: articleUrl,
  };

  let startDate = melbourneDateOf(startTs);
  let endDate = melbourneDateOf(endTs);
  let tsTrusted = true;
  if (startDate > endDate) {
    // The CMS sometimes publishes a bad FromDate. Fall back to the explicit
    // date range in the title ("Sunday 2 August to Wednesday 5 August").
    const rm = (a.ArticleTitle ?? "").match(
      /((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\s+\d{1,2}\s+[A-Za-z]+)\s+(?:to|until|-|–)\s+((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\s+\d{1,2}\s+[A-Za-z]+)/
    );
    const s = rm && parseDayMonth(rm[1], refDate);
    const e = rm && parseDayMonth(rm[2], refDate);
    if (!s || !e || s > e) return null; // can't trust anything here
    startDate = s;
    endDate = e;
    tsTrusted = false;
  }

  // "each night" disruptions repeat daily: model as a date range with a
  // daily from-time window, not one continuous timestamp span (which would
  // wrongly black out the daytime in between).
  if (/each night|nightly/i.test(allText)) {
    const { startMin } = matchTimeWindow(allText);
    // ToDate is usually the small hours after the final night; step back to
    // name the final service night.
    const lastNight = tsTrusted
      ? melbourneDateOf(new Date(new Date(endTs).getTime() - 4 * 3600e3).toISOString())
      : endDate;
    return {
      ...base,
      startDate,
      endDate: lastNight,
      startMin: startMin ?? 21 * 60,
    };
  }

  return {
    ...base,
    startDate,
    endDate,
    startTs: tsTrusted ? startTs : undefined,
    endTs: tsTrusted ? endTs : undefined,
  };
}

// Parse one page's tables into disruptions. refDate anchors year inference.
// pageUrl becomes each disruption's official-details link.
export function parsePage(pageHtml: string, refDate: Date, pageUrl?: string): Disruption[] {
  const out = new Map<string, Disruption>();
  for (const table of extractTableHtml(pageHtml)) {
    for (const row of tableRows(table)) {
      if (!DISRUPTION_KEYWORDS.test(row)) continue;
      const lineIds = matchLines(row);
      if (lineIds.length === 0) continue;

      // Date range: "Monday 13 July to Thursday 16 July" or a single date.
      const rangeM = row.match(
        /((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\s+\d{1,2}\s+[A-Za-z]+)(?:\s+(?:to|until|-|–)\s+((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\s+\d{1,2}\s+[A-Za-z]+))?/
      );
      if (!rangeM) continue;
      const startDate = parseDayMonth(rangeM[1], refDate);
      const endDate = rangeM[2] ? parseDayMonth(rangeM[2], refDate) : startDate;
      if (!startDate || !endDate) continue;

      const stations = sectionStations(row);
      const { startMin, endMin } = matchTimeWindow(row);

      // Description sentence for display: from the disruption keyword onward.
      const kwIndex = row.search(DISRUPTION_KEYWORDS);
      const rawText = row.slice(kwIndex).split(/(?<=\.)\s/)[0].trim();

      // "Buses replace trains." with no section text = the whole line is
      // replaced; that's a confident blackout, not a warning.
      const wholeLineExplicit = !stations && !/\b(between|from)\b/i.test(rawText);

      const id = hashId(`${lineIds.join(",")}|${startDate}|${endDate}|${rawText}`);
      if (out.has(id)) continue;
      out.set(id, {
        id,
        lineIds,
        fromStation: stations?.[0],
        toStation: stations?.[stations.length - 1],
        stations: stations ?? undefined,
        wholeLine: !stations,
        parsed: !!stations || wholeLineExplicit,
        startDate,
        endDate,
        startMin,
        endMin,
        rawText,
        source: "planned-works",
        url: pageUrl,
      });
    }
  }
  return [...out.values()];
}
