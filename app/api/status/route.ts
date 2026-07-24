import { NextRequest, NextResponse } from "next/server";
import { computeStatus } from "@/lib/status";
import { getDisruptionData } from "@/lib/disruptions";

export async function GET(req: NextRequest) {
  const atParam = req.nextUrl.searchParams.get("at");
  const at = atParam ? new Date(atParam) : new Date();
  if (isNaN(at.getTime())) {
    return NextResponse.json({ error: "Invalid 'at' datetime" }, { status: 400 });
  }
  const data = await getDisruptionData();
  const status = computeStatus(data.disruptions, at, data.dataUpdatedAt);
  return NextResponse.json(status, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  });
}
