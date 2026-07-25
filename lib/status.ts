import type {
  DayStatus,
  Disruption,
  LineId,
  SegmentStatus,
  StatusResponse,
} from "./types";
import { EDGES, LINE_DEFS, STATIONS, edgesBetween, lineEdges } from "./network/build";
import { isServiceRunning, toMelTime, type MelTime } from "./spans";
import { melbourneLocalToIso, melbourneTimeLabel } from "./meltz";

// Does this disruption apply at the given Melbourne-local moment?
function disruptionActiveAt(d: Disruption, t: MelTime, at: Date): boolean {
  // Exact timestamp bounds (PTV API) beat date-range + daily window.
  if (d.startTs || d.endTs) {
    if (d.startTs && at < new Date(d.startTs)) return false;
    if (d.endTs && at > new Date(d.endTs)) return false;
    return true;
  }
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
  const active = disruptions.filter((d) => disruptionActiveAt(d, t, at));

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
      // Outside timetabled hours "no trains" already tells the story;
      // don't paint bus replacements over it at 4am.
      if (!isServiceRunning(lineId, t)) continue;
      const span = lineSpan(d, lineId);
      if (span) {
        const edges = edgesBetween(lineId, span.from, span.to);
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
      } else if (d.parsed && d.wholeLine) {
        // Explicit whole-line replacement ("Buses replace trains.").
        for (const e of lineEdges(lineId)) {
          const s = segmentMap.get(e.id)!;
          s.status = "bus-replacement";
          s.disruptionIds.push(d.id);
        }
      } else {
        // Couldn't parse a section: warn on the whole line, never a
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

// The affected section of a disruption on one line: min..max of the
// mentioned stations that exist on that line (needs at least 2 to span).
function lineSpan(d: Disruption, lineId: LineId): { from: string; to: string } | null {
  if (!d.parsed) return null;
  const mentioned = d.stations ?? (d.fromStation && d.toStation ? [d.fromStation, d.toStation] : []);
  const line = LINE_DEFS.find((l) => l.id === lineId);
  if (!line) return null;
  const idxs = mentioned
    .map((s) => line.stations.indexOf(s))
    .filter((i) => i !== -1)
    .sort((a, b) => a - b);
  if (idxs.length < 2) return null;
  return { from: line.stations[idxs[0]], to: line.stations[idxs[idxs.length - 1]] };
}

// Is a station inside the affected section of a disruption on a given line?
function stationInSection(stationId: string, d: Disruption, lineId: LineId): boolean {
  if (d.wholeLine || !d.parsed) return true;
  const span = lineSpan(d, lineId);
  if (!span) return false;
  const line = LINE_DEFS.find((l) => l.id === lineId)!;
  const i = line.stations.indexOf(stationId);
  const lo = line.stations.indexOf(span.from);
  const hi = line.stations.indexOf(span.to);
  return i !== -1 && i >= lo && i <= hi;
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
        // A day is only fully "disrupted" when some hit covers the whole
        // service day; edge days of a timestamped span are partial.
        const dayStart = new Date(melbourneLocalToIso(`${dateStr} 06:00:00`));
        const dayEnd = new Date(melbourneLocalToIso(`${dateStr} 21:00:00`));
        const coversFullDay = (h: Disruption): boolean => {
          if (h.startTs || h.endTs) {
            const from = h.startTs ? new Date(h.startTs) : new Date(0);
            const to = h.endTs ? new Date(h.endTs) : new Date(8640000000000000);
            return from <= dayStart && to >= dayEnd;
          }
          return h.startMin === undefined && h.endMin === undefined;
        };
        const fullDay = hits.some((h) => h.parsed && coversFullDay(h));
        const first = hits[0];
        let summary = first.rawText;
        if (!fullDay) {
          if (first.startTs && new Date(first.startTs) > dayStart) {
            summary = `Trains run until ${melbourneTimeLabel(first.startTs)}, then ${first.rawText
              .charAt(0)
              .toLowerCase()}${first.rawText.slice(1)}`;
          } else if (first.endTs && new Date(first.endTs) < dayEnd) {
            summary = `${first.rawText} until ${melbourneTimeLabel(first.endTs)}, then trains resume`;
          } else if (first.startMin !== undefined) {
            summary = `Trains run until ${minutesToLabel(first.startMin)}, then ${first.rawText
              .charAt(0)
              .toLowerCase()}${first.rawText.slice(1)}`;
          }
        }
        days.push({
          date: dateStr,
          status: fullDay ? "disrupted" : "partial",
          summary,
          disruptionIds: hits.map((h) => h.id),
        });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
