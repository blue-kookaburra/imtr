import type {
  DayStatus,
  Disruption,
  LineId,
  SegmentStatus,
  StatusResponse,
} from "./types";
import { EDGES, LINE_DEFS, STATIONS, edgesBetween, lineEdges } from "./network/build";
import { isServiceRunning, toMelTime, type MelTime } from "./spans";

// Does this disruption apply at the given Melbourne-local moment?
function disruptionActiveAt(d: Disruption, t: MelTime): boolean {
  if (t.dateStr < d.startDate || t.dateStr > d.endDate) return false;
  if (d.startMin !== undefined && t.minutes < d.startMin) return false;
  if (d.endMin !== undefined && t.minutes > d.endMin) return false;
  return true;
}

// Compute the map view: per-segment status at a moment in time.
// Precedence per segment: bus-replacement > no-service > running.
// Unparseable disruptions surface as line-level warnings, never blackouts.
export function computeStatus(
  disruptions: Disruption[],
  at: Date,
  dataUpdatedAt: string
): StatusResponse {
  const t = toMelTime(at);
  const active = disruptions.filter((d) => disruptionActiveAt(d, t));

  const segmentMap = new Map<string, SegmentStatus>();
  for (const e of EDGES) {
    segmentMap.set(e.id, { edgeId: e.id, status: "running", disruptionIds: [] });
  }

  // Baseline: outside timetabled hours the whole line is no-service.
  for (const line of LINE_DEFS) {
    if (!isServiceRunning(line.id, t)) {
      for (const e of lineEdges(line.id)) {
        const s = segmentMap.get(e.id)!;
        s.status = "no-service";
      }
    }
  }

  const lineWarnings = new Map<LineId, Set<string>>();
  for (const d of active) {
    for (const lineId of d.lineIds) {
      if (d.parsed && d.fromStation && d.toStation) {
        const edges = edgesBetween(lineId, d.fromStation, d.toStation);
        if (edges.length === 0) {
          // Section didn't map onto this line's stations: warn, don't guess.
          if (!lineWarnings.has(lineId)) lineWarnings.set(lineId, new Set());
          lineWarnings.get(lineId)!.add(d.id);
          continue;
        }
        for (const e of edges) {
          const s = segmentMap.get(e.id)!;
          s.status = "bus-replacement";
          s.disruptionIds.push(d.id);
        }
      } else {
        // No station section parsed: warn on the whole line, never a
        // possibly-wrong blackout.
        if (!lineWarnings.has(lineId)) lineWarnings.set(lineId, new Set());
        lineWarnings.get(lineId)!.add(d.id);
      }
    }
  }

  const staleMs = Date.now() - new Date(dataUpdatedAt).getTime();
  return {
    at: at.toISOString(),
    generatedAt: new Date().toISOString(),
    dataUpdatedAt,
    stale: staleMs > 3 * 24 * 3600 * 1000,
    segments: [...segmentMap.values()],
    lineWarnings: [...lineWarnings.entries()].map(([lineId, ids]) => ({
      lineId,
      disruptionIds: [...ids],
    })),
    disruptions: active,
  };
}

// Is a station inside the affected section of a disruption on a given line?
function stationInSection(stationId: string, d: Disruption, lineId: LineId): boolean {
  if (d.wholeLine) return true;
  if (!d.fromStation || !d.toStation) return true;
  const line = LINE_DEFS.find((l) => l.id === lineId);
  if (!line) return false;
  const i = line.stations.indexOf(stationId);
  const ia = line.stations.indexOf(d.fromStation);
  const ib = line.stations.indexOf(d.toStation);
  if (i === -1 || ia === -1 || ib === -1) return false;
  const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
  return i >= lo && i <= hi;
}

function minutesToLabel(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const ap = h24 >= 12 ? "pm" : "am";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h}${ap}` : `${h}:${String(m).padStart(2, "0")}${ap}`;
}

// Per-day status for a station over a date range (calendar view).
export function computeCalendar(
  stationId: string,
  disruptions: Disruption[],
  from: string,
  to: string,
  dataUpdatedAt: string,
  horizonEnd: string
): DayStatus[] {
  const station = STATIONS.get(stationId);
  if (!station) return [];
  const days: DayStatus[] = [];
  const cursor = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (cursor <= end) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (dateStr > horizonEnd) {
      days.push({ date: dateStr, status: "no-data", disruptionIds: [] });
    } else {
      const hits = disruptions.filter(
        (d) =>
          dateStr >= d.startDate &&
          dateStr <= d.endDate &&
          d.lineIds.some(
            (lineId) => station.lines.includes(lineId) && stationInSection(stationId, d, lineId)
          )
      );
      if (hits.length === 0) {
        days.push({ date: dateStr, status: "normal", disruptionIds: [] });
      } else {
        const timeWindowed = hits.every((h) => h.startMin !== undefined || h.endMin !== undefined);
        const parsedAll = hits.every((h) => h.parsed);
        const first = hits[0];
        let summary = first.rawText;
        if (first.startMin !== undefined) {
          summary = `Trains run until ${minutesToLabel(first.startMin)}, then ${first.rawText
            .charAt(0)
            .toLowerCase()}${first.rawText.slice(1)}`;
        }
        days.push({
          date: dateStr,
          // Partial when time-windowed or when we couldn't fully parse (warn,
          // don't claim a full-day outage we're not sure about).
          status: timeWindowed || !parsedAll ? "partial" : "disrupted",
          summary,
          disruptionIds: hits.map((h) => h.id),
        });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
