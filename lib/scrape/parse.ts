import type { Disruption, LineId } from "../types";
import { LINES } from "../network/data";
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

// "between North Melbourne, Newport and Williamstown" /
// "from Newport to Werribee" / "between Parliament, Alamein and Box Hill".
// Returns every station mentioned so multi-branch sections can be spanned
// per line downstream. Explicit sections only — a loop closure is a
// different shape (see `loopSkippedStations` below) and is never faked as a
// span here.
export function sectionStations(text: string): string[] | null {
  const m = text.match(
    /(?:between|from)\s+([A-Za-z',\/ ]+?)(?:\.|,?\s+(?:each|nightly|daily|after|until|while|due|stations|when|what|why)\b|\s+\d|$)/i
  );
  if (!m) return null;
  const parts = m[1].split(/,|\/|\band\b|\bto\b/i);
  const ids = [...new Set(parts.map(resolveStation).filter((s): s is string => !!s))];
  return ids.length >= 2 ? ids : null;
}

// The three underground ring stations. Flinders Street and Southern Cross are
// on the surface route every train uses, loop or direct, so they are never
// skipped.
const LOOP_SKIPPED = ["flagstaff", "melbourne-central", "parliament"];

// "The line runs, the ring does not." The subject must be TRAINS — "buses run
// direct to Flinders Street" is a whole-line bus replacement, and reading it as
// a loop closure would report the trunk as running normally. That guard has
// to survive "trains" appearing as the OBJECT of a replacement phrase too:
// "buses replace trains and run direct to Flinders Street" and "replacement
// buses for trains run direct to Flinders Street" both put "trains" right
// before "run direct" without it ever being the thing doing the running. The
// negative lookbehinds reject "trains" when it's what's being replaced or
// stood in for, so only a real "trains run/do not run/bypass" claim counts.
// A skip list naming a single loop station is not a ring closure (that
// station could be skipped for any number of unrelated reasons) — it only
// counts once all three ring stations are named together, stable CMS
// boilerplate.
const LOOP_CLOSED =
  /(?<!replace[sd]?\s)(?<!replacing\s)(?<!for\s)\btrains?\b[^.]{0,60}?\b(?:run(?:ning|s)?\s+direct\s+to\s+flinders\s+street|not\s+(?:run\s+)?(?:via|through)\s+the\s+city\s+loop|bypass(?:ing|es)?\s+the\s+city\s+loop|not\s+stop\s+at\s+flagstaff,?\s+melbourne\s+central\s+and\s+parliament)|\bcity\s+loop\s+(?:is\s+)?closed\b/i;

export function loopSkippedStations(text: string): string[] | null {
  return LOOP_CLOSED.test(text) ? [...LOOP_SKIPPED] : null;
}

// A whole-line bus/coach replacement is a separate claim from a City Loop
// closure, and the two can co-occur on one disruption ("Buses replace
// trains. The City Loop is closed."). Detect it by its own wording rather
// than inferring it from the mere absence of a parsed station section, so a
// co-occurring loop sentence can never suppress it.
//
// Split into strong/weak because the weak alternatives ("no trains", "trains
// do not run", "bus replacement") also show up in sentences that describe
// only a City Loop ring closure ("Trains do not run via the City Loop"),
// which must NOT black out the whole line. The strong alternatives (an
// explicit "buses/coaches replace trains") are unambiguous, so they always
// mean the whole line — including alongside a loop closure.
const WHOLE_LINE_REPLACED_STRONG = /\bbuses\s+replace\s+trains\b|\bcoaches\s+replace\s+trains\b/i;
const WHOLE_LINE_REPLACED_WEAK = /\bbus\s+replacement\b|\bno\s+trains\b|\btrains\s+(?:do|will)?\s*not\s+run\b/gi;

// What a weak claim is talking about is decided by its own sentence, not by
// whether a loop closure was detected elsewhere in the row. Keying off
// `skipsStations` instead got this wrong in both directions: "No trains on
// the Belgrave line. The City Loop is closed." lost the whole-line claim to
// the loop sentence next to it, while "There are no trains through the City
// Loop." blacked out the entire line because that phrasing isn't one
// LOOP_CLOSED recognises, so nothing was there to suppress it.
const LOOP_SCOPE =
  /\bcity\s+loop\b|\bflagstaff\b|\bmelbourne\s+central\b|\bparliament\b/i;

// The sentence containing `index`. Semicolons separate independent clauses in
// this CMS's register ("Trains bypass the City Loop; no trains will stop at
// ..."), so they bound a scope too.
function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(".", index), text.lastIndexOf(";", index));
  let end = text.length;
  for (const mark of [".", ";"]) {
    const i = text.indexOf(mark, index);
    if (i !== -1 && i < end) end = i;
  }
  return text.slice(start + 1, end);
}

// True when the text claims the whole line is replaced. A weak claim counts
// only when its own sentence is not about the City Loop — otherwise it is
// describing the ring, which `skipsStations` already carries.
function claimsWholeLine(text: string): boolean {
  if (WHOLE_LINE_REPLACED_STRONG.test(text)) return true;
  WHOLE_LINE_REPLACED_WEAK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WHOLE_LINE_REPLACED_WEAK.exec(text))) {
    if (!LOOP_SCOPE.test(sentenceAround(text, m.index))) return true;
  }
  return false;
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

// Includes the loop-specific phrasings ("will not run [via/through] the
// loop", "bypassing", "will not stop at") so a pure loop closure — which
// never says "buses replace trains" — still clears this gate and reaches
// loopSkippedStations below instead of being silently dropped.
// "replacement buses" is the same claim as "bus replacement" with the words
// the other way round; missing it dropped the whole row before any section or
// loop logic ran, which is the quietest way to lose a disruption.
const DISRUPTION_KEYWORDS =
  /buses replace|bus replacement|replacement (?:buses|coaches)|no trains|trains? (?:do |will )?not run|bypass(?:ing|es)?|will not stop at|closed|coaches replace|service(?:s)? (?:will )?not run/i;

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

  // See DISRUPTION_KEYWORDS above for why the loop-specific phrasings are
  // included: a pure loop closure never says "buses replace trains".
  const SERVICE_GAP =
    /buses replace|bus replacement|replacement (?:buses|coaches)|no trains|trains? (?:do |will )?not run|bypass(?:ing|es)?|will not stop at|coaches replace|closed|start and end at/i;
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

  // A loop closure is a precise claim on its own — it must never be widened
  // into "the whole line is replaced" just because no separate section was
  // stated, and it must never fall back to "couldn't parse a section" either.
  const skipsStations = loopSkippedStations(allText) ?? undefined;

  // Title/subtitle hinting at a station section we failed to parse: don't
  // confidently call anything whole-line in that case, whole-line-worded or
  // not — a mangled "between X and Y" is not "no section at all".
  const titleHintsUnparsedSection = /between/i.test(`${a.ArticleTitle ?? ""} ${a.SubtitleMessage ?? ""}`);
  // Whole-line bus/coach replacement is its own claim, independent of a
  // co-occurring City Loop closure — both can be true on one disruption.
  const wholeLine = !stations && !titleHintsUnparsedSection && claimsWholeLine(allText);

  const base = {
    id: `art-${a.ID}`,
    lineIds,
    fromStation: stations?.[0],
    toStation: stations?.[stations.length - 1],
    stations: stations ?? undefined,
    skipsStations,
    wholeLine,
    // No section found: confident whole-line only when the title doesn't
    // hint at a station section we failed to parse. A loop closure is its
    // own confident claim regardless.
    parsed: !!stations || !!skipsStations || wholeLine || !titleHintsUnparsedSection,
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
      // A loop closure is a precise claim on its own — it must never be
      // widened into "the whole line is replaced" just because no separate
      // section was stated, and it must never fall back to "couldn't parse a
      // section" either.
      const skipsStations = loopSkippedStations(row) ?? undefined;
      const { startMin, endMin } = matchTimeWindow(row);

      // Description sentence for display: from the disruption keyword onward.
      const kwIndex = row.search(DISRUPTION_KEYWORDS);
      const rawText = row.slice(kwIndex).split(/(?<=\.)\s/)[0].trim();

      // "Buses replace trains." with no section text = the whole line is
      // replaced; that's a confident blackout, not a warning. This is
      // independent of a co-occurring loop closure — "Buses replace trains.
      // The City Loop is closed." busses the whole line AND skips the ring,
      // and neither claim should suppress the other.
      const wholeLine =
        !stations && !/\b(between|from)\b/i.test(rawText) && claimsWholeLine(rawText);

      const id = hashId(`${lineIds.join(",")}|${startDate}|${endDate}|${rawText}`);
      if (out.has(id)) continue;
      out.set(id, {
        id,
        lineIds,
        fromStation: stations?.[0],
        toStation: stations?.[stations.length - 1],
        stations: stations ?? undefined,
        skipsStations,
        wholeLine,
        parsed: !!stations || wholeLine || !!skipsStations,
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
