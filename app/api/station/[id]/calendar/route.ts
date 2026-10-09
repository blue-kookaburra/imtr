import { NextRequest, NextResponse } from "next/server";
import { computeCalendar } from "@/lib/status";
import { getDisruptionData } from "@/lib/disruptions";
import { STATIONS } from "@/lib/network/build";
import type { CalendarResponse } from "@/lib/types";
import { melbourneToday } from "@/lib/meltz";

const MAX_RANGE_DAYS = 62;
const DAY_MS = 86400e3;

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  // Rejects impossible dates like 2026-02-31, which Date would roll forward.
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!STATIONS.has(id)) {
    return NextResponse.json({ error: "Unknown station" }, { status: 404 });
  }
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ?? melbourneToday();
  const to =
    sp.get("to") ?? melbourneToday(new Date(Date.now() + 27 * DAY_MS));
  // Bound the range: computeCalendar walks every day, so an open-ended range
  // would let one request spin the CPU.
  const span = (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY_MS;
  if (!validDate(from) || !validDate(to) || span < 0 || span >= MAX_RANGE_DAYS) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }
  const data = await getDisruptionData();
  const days = computeCalendar(id, data.disruptions, from, to, data.dataUpdatedAt, data.horizonEnd);
  const body: CalendarResponse = {
    stationId: id,
    from,
    to,
    dataUpdatedAt: data.dataUpdatedAt,
    days,
    disruptions: data.disruptions.filter((d) => days.some((day) => day.disruptionIds.includes(d.id))),
  };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
  });
}
