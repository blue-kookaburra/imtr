import type {
  DayStatus,
  Disruption,
  LineId,
  SegmentStatus,
  StationLineStatus,
  StationStatus,
  StationStatusKind,
  StatusResponse,
} from "./types";
import { EDGES, LINE_DEFS, STATIONS, edgesBetween, lineEdges, matchSequence } from "./network/build";
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
      // A City Loop closure rides alongside any explicit section/whole-line
      // meaning below — it never replaces it. Sever just the ring edges that
      // touch a skipped station (never Flinders Street/Southern Cross, which
      // are the surface route every train uses whether via the loop or not).
      if (d.skipsStations) {
        for (const e of lineEdges(lineId)) {
          if (!d.skipsStations.includes(e.from) && !d.skipsStations.includes(e.to)) continue;
          const s = segmentMap.get(e.id)!;
          s.status = "bus-replacement";
          s.disruptionIds.push(d.id);
        }
      }

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
    stations: computeStationStatuses(active, t, lineWarnings),
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
  const seq = matchSequence(lineId);
  if (seq.length === 0) return null;
  const idxs = mentioned
    .map((s) => seq.indexOf(s))
    .filter((i) => i !== -1)
    .sort((a, b) => a - b);
  if (idxs.length < 2) return null;
  return { from: seq[idxs[0]], to: seq[idxs[idxs.length - 1]] };
}

// Is a station inside the affected section of a disruption on a given line?
function stationInSection(stationId: string, d: Disruption, lineId: LineId): boolean {
  if (d.wholeLine || !d.parsed) return true;
  const span = lineSpan(d, lineId);
  if (!span) return false;
  const seq = matchSequence(lineId);
  const i = seq.indexOf(stationId);
  const lo = seq.indexOf(span.from);
  const hi = seq.indexOf(span.to);
  return i !== -1 && i >= lo && i <= hi;
}

// Strongest signal wins when several lines disagree at one station.
// `no-service` ranks below everything and is filtered out before this is used,
// so a single sleeping line can never outrank eleven running ones.
const STATION_RANK: Record<StationStatusKind, number> = {
  "no-service": -1,
  normal: 0,
  warning: 1,
  boundary: 2,
  cut: 3,
};

// Is this station at an end of the affected section that trains can still
// reach from the far side? An end that is also the line's terminus has no far
// side — every service to it is replaced — so it is `cut`, not `boundary`.
// Reporting "trains terminate here" at Belgrave during a Ringwood–Belgrave
// shutdown would be a false all-clear, which is exactly what fail-visible
// exists to prevent.
function reachableFromBeyond(
  stationId: string,
  span: { from: string; to: string },
  lineId: LineId
): boolean {
  const seq = matchSequence(lineId);
  const i = seq.indexOf(stationId);
  if (i === -1) return false;
  if (stationId === span.from) return i > 0;
  if (stationId === span.to) return i < seq.length - 1;
  return false;
}

// Per-station status at a moment. A station at the very edge of a section is
// `boundary`, not `cut` — trains still reach it from the far side, which is
// what people actually want to know.
export function computeStationStatuses(
  active: Disruption[],
  t: MelTime,
  lineWarnings: Map<LineId, Set<string>>
): StationStatus[] {
  const out: StationStatus[] = [];

  for (const station of STATIONS.values()) {
    const perLine: StationLineStatus[] = [];
    const ids = new Set<string>();

    for (const lineId of station.lines) {
      const warned = lineWarnings.get(lineId);
      const unmapped = warned !== undefined && warned.size > 0;
      if (warned) for (const id of warned) ids.add(id);

      // Outside timetabled hours there is nothing to disrupt. Say that plainly
      // instead of reporting "normal", which a reader takes as "trains running".
      if (!isServiceRunning(lineId, t)) {
        perLine.push({ lineId, status: "no-service", unmapped });
        continue;
      }

      let status: StationStatusKind = unmapped ? "warning" : "normal";

      for (const d of active) {
        if (!d.lineIds.includes(lineId)) continue;

        // City Loop closure: this exact station is named as skipped, full
        // stop. Not a span, so it must never go through lineSpan/reachability
        // — that logic treats index 0 (Flinders Street) as unreachable "from
        // beyond", which would wrongly cut the station the text says trains
        // still run to.
        if (d.skipsStations?.includes(station.id)) {
          if (STATION_RANK.cut > STATION_RANK[status]) status = "cut";
          ids.add(d.id);
          continue;
        }

        // Mirror computeStatus's precedence. A disruption with no usable span
        // is a line-level warning, already carried by `unmapped` — never a
        // per-station blackout. This is the fail-visible rule.
        const span = lineSpan(d, lineId);
        let kind: StationStatusKind | null = null;
        if (span) {
          if (!stationInSection(station.id, d, lineId)) continue;
          kind = reachableFromBeyond(station.id, span, lineId) ? "boundary" : "cut";
        } else if (d.parsed && d.wholeLine) {
          kind = "cut";
        }
        if (!kind) continue;

        if (STATION_RANK[kind] > STATION_RANK[status]) status = kind;
        ids.add(d.id);
      }

      perLine.push({ lineId, status, unmapped });
    }

    // `no-service` only wins when every line is asleep. Otherwise the worst
    // real fault among the running lines is what matters.
    const running = perLine.filter((l) => l.status !== "no-service");
    const overall: StationStatusKind = running.length
      ? running.reduce<StationStatusKind>(
          (acc, l) => (STATION_RANK[l.status] > STATION_RANK[acc] ? l.status : acc),
          "normal"
        )
      : "no-service";

    out.push({
      stationId: station.id,
      status: overall,
      unmapped: perLine.some((l) => l.unmapped),
      disruptionIds: [...ids],
      lines: perLine,
    });
  }

  return out;
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
