import { NextRequest, NextResponse } from "next/server";
import { computeCalendar } from "@/lib/status";
import { getDisruptionData } from "@/lib/disruptions";
import { STATIONS } from "@/lib/network/build";
import type { CalendarResponse } from "@/lib/types";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!STATIONS.has(id)) {
    return NextResponse.json({ error: "Unknown station" }, { status: 404 });
  }
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ?? new Date().toISOString().slice(0, 10);
  const to = sp.get("to") ?? new Date(Date.now() + 27 * 86400e3).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
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
