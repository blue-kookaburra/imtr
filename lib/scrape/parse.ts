import type { Disruption, LineId } from "../types";
import { LINES } from "../network/data";
import { findStationId } from "../network/build";

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

// Match line mentions like "Werribee Line", "Werribee and Williamstown line".
function matchLines(text: string): LineId[] {
  const found: LineId[] = [];
  const lower = text.toLowerCase();
  // Only look in the part of the row before the description keyword, so a
  // sentence like "buses replace trains" naming stations doesn't match lines.
  for (const line of LINES) {
    const name = line.name.toLowerCase();
    const re = new RegExp(`\\b${name}(\\s+(and|,)|\\s+lines?\\b)`, "i");
    if (re.test(lower) || lower.includes(`${name} line`)) {
      found.push(line.id);
    }
  }
  return found;
}

// "between North Melbourne, Newport and Williamstown" / "from Newport to Werribee"
function matchSection(text: string): { from: string; to: string } | null {
  const patterns = [
    /between\s+([A-Za-z' ]+?)\s+and\s+([A-Za-z' ]+?)(?:[.,]|$| stations| in )/i,
    /between\s+([A-Za-z' ]+?),\s*(?:[A-Za-z' ]+,\s*)*[A-Za-z' ]+\s+and\s+([A-Za-z' ]+?)(?:[.,]|$)/i,
    /from\s+([A-Za-z' ]+?)\s+to\s+([A-Za-z' ]+?)(?:[.,]|$| stations)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    // The "between A, B and C" case: try first & last names in the list.
    const listMatch = text.match(/between\s+([A-Za-z', ]+?)\s+and\s+([A-Za-z' ]+?)(?:[.,]|$| stations)/i);
    let fromName = m[1];
    const toName = m[2];
    if (listMatch && listMatch[1].includes(",")) {
      fromName = listMatch[1].split(",")[0];
    }
    const from = findStationId(fromName);
    const to = findStationId(toName.trim());
    if (from && to && from !== to) return { from, to };
  }
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
  return { startMin, endMin };
}

function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "d" + (h >>> 0).toString(36);
}

const DISRUPTION_KEYWORDS =
  /buses replace|bus replacement|no trains|trains (?:do )?not run|closed|coaches replace|service(?:s)? (?:will )?not run/i;

// Parse one page's tables into disruptions. refDate anchors year inference.
export function parsePage(pageHtml: string, refDate: Date): Disruption[] {
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

      const section = matchSection(row);
      const { startMin, endMin } = matchTimeWindow(row);

      // Description sentence for display: from the disruption keyword onward.
      const kwIndex = row.search(DISRUPTION_KEYWORDS);
      const rawText = row.slice(kwIndex).split(/(?<=\.)\s/)[0].trim();

      const id = hashId(`${lineIds.join(",")}|${startDate}|${endDate}|${rawText}`);
      if (out.has(id)) continue;
      out.set(id, {
        id,
        lineIds,
        fromStation: section?.from,
        toStation: section?.to,
        wholeLine: !section,
        parsed: !!section,
        startDate,
        endDate,
        startMin,
        endMin,
        rawText,
        source: "planned-works",
      });
    }
  }
  return [...out.values()];
}
