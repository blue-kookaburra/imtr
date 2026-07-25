import crypto from "crypto";
import type { Disruption, LineId } from "./types";
import { LINES } from "./network/data";
import { findStationId } from "./network/build";

// Optional live-disruption enrichment via the PTV Timetable API v3.
// The app works fully without it; configure PTV_DEV_ID and PTV_API_KEY
// to add unplanned/live disruptions on top of scraped planned works.

const PTV_BASE = "https://timetableapi.ptv.vic.gov.au";

function signedUrl(path: string): string | null {
  const devId = process.env.PTV_DEV_ID;
  const key = process.env.PTV_API_KEY;
  if (!devId || !key) return null;
  const withDevId = `${path}${path.includes("?") ? "&" : "?"}devid=${devId}`;
  const sig = crypto.createHmac("sha1", key).update(withDevId).digest("hex").toUpperCase();
  return `${PTV_BASE}${withDevId}&signature=${sig}`;
}

interface PtvDisruption {
  disruption_id: number;
  title: string;
  description: string;
  disruption_type: string;
  from_date: string | null;
  to_date: string | null;
  url: string | null;
  routes: { route_name: string }[];
}

function routeNameToLineIds(name: string): LineId[] {
  const lower = name.toLowerCase();
  return LINES.filter((l) => lower.includes(l.name.toLowerCase())).map((l) => l.id);
}

function sectionFromText(text: string): { from?: string; to?: string } {
  const m = text.match(/(?:between|from)\s+([A-Za-z' ]+?)\s+(?:and|to)\s+([A-Za-z' ]+?)(?:[.,]|$| stations)/i);
  if (!m) return {};
  const from = findStationId(m[1]);
  const to = findStationId(m[2]);
  return from && to && from !== to ? { from, to } : {};
}

function melDateStr(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
}

// Live + planned disruptions for metro trains (route_type 0). Returns []
// when the API is unconfigured or unavailable — callers must treat that as
// "no extra info". PTV records carry exact timestamps ("buses from 9:30pm"),
// which the scraped planned-works tables lack.
export async function fetchLiveDisruptions(): Promise<Disruption[]> {
  const url = signedUrl("/v3/disruptions?route_types=0&disruption_status=current");
  if (!url) return [];
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const data = (await res.json()) as { disruptions?: { metro_train?: PtvDisruption[] } };
    const items = data.disruptions?.metro_train ?? [];
    return items.flatMap((d): Disruption[] => {
      const lineIds = [...new Set(d.routes.flatMap((r) => routeNameToLineIds(r.route_name)))];
      if (lineIds.length === 0) return [];
      const text = `${d.title} ${d.description}`;
      if (!/buses replace|bus replacement|no trains|closed|not run/i.test(text)) return [];
      const section = sectionFromText(text);
      const start = d.from_date ? melDateStr(d.from_date) : melDateStr(new Date().toISOString());
      const end = d.to_date ? melDateStr(d.to_date) : start;
      return [
        {
          id: `ptv-${d.disruption_id}`,
          lineIds,
          fromStation: section.from,
          toStation: section.to,
          stations: section.from && section.to ? [section.from, section.to] : undefined,
          wholeLine: !section.from,
          parsed: !!section.from,
          startDate: start,
          endDate: end,
          startTs: d.from_date ?? undefined,
          endTs: d.to_date ?? undefined,
          rawText: d.title,
          source: "ptv-api",
          url: d.url ?? undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}
