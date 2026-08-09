"use client";

import { LINE_BY_ID, STATIONS } from "@/lib/network/build";
import { LABEL_PLACEMENT, RENDERED_STATIONS, STATION_XY } from "@/lib/map/geometry";
import type { LineId, StationStatus } from "@/lib/types";

interface Props {
  statusByStation: Map<string, StationStatus>;
  focusedLine: LineId | null;
  zoom: number;
}

// Past this zoom every station is named; below it only the ones that earn it.
const REVEAL_ZOOM = 0.6;

// Only the outer (suburban) end -- index 0 is always the city anchor
// (flinders-street or southern-cross) by construction, per AGENTS.md's
// network-model section, so checking it too would bold-cap the CBD hubs.
function isLineEnd(stationId: string, lineId: LineId): boolean {
  const line = LINE_BY_ID.get(lineId);
  if (!line) return false;
  return line.stations[line.stations.length - 1] === stationId;
}

export default function MapLabels({ statusByStation, focusedLine, zoom }: Props) {
  const revealAll = zoom >= REVEAL_ZOOM;

  return (
    <g aria-hidden>
      {[...STATIONS.values()].map((s) => {
        if (!RENDERED_STATIONS.has(s.id)) return null;
        const xy = STATION_XY[s.id];
        const place = LABEL_PLACEMENT[s.id];
        if (!xy || !place) return null;

        const onFocusedLine = focusedLine !== null && s.lines.includes(focusedLine);
        const isTerminus = s.lines.some((l) => isLineEnd(s.id, l));
        // Must NOT include no-service: at 3am every line is asleep, and
        // treating that as "disrupted" would force all 222 labels on at once.
        // Prefer the focused line's own reading over worst-of-all-lines, the
        // same way MapStations and StationSheet do, so a focused-line user
        // never sees a red label over a dot their own line renders normal.
        const sst = statusByStation.get(s.id);
        const focusedEntry = focusedLine
          ? sst?.lines.find((l) => l.lineId === focusedLine)
          : undefined;
        const st = focusedEntry?.status ?? sst?.status;
        const unmapped = focusedEntry?.unmapped ?? sst?.unmapped ?? false;
        const disrupted =
          st === "warning" || st === "boundary" || st === "cut" || unmapped;

        // Always: disrupted stations, interchanges, termini. With a line
        // focused, also that line's stations. Everything else waits for zoom.
        const show =
          disrupted || s.interchange || isTerminus || onFocusedLine || revealAll;
        if (!show) return null;

        const ghosted = focusedLine !== null && !s.lines.includes(focusedLine);

        return (
          <text
            key={s.id}
            x={xy[0] + place.dx}
            y={xy[1] + place.dy}
            textAnchor={place.anchor}
            dominantBaseline={place.dy > 4 ? "hanging" : place.dy < -4 ? "auto" : "middle"}
            transform={
              place.angle
                ? `rotate(${place.angle} ${xy[0] + place.dx} ${xy[1] + place.dy})`
                : undefined
            }
            fontSize={s.interchange ? 15 : 13}
            fontWeight={s.interchange || disrupted || isTerminus ? 700 : 500}
            fill={disrupted ? "var(--bad)" : "var(--map-label)"}
            opacity={ghosted ? 0.35 : 1}
            paintOrder="stroke"
            stroke="var(--map-canvas)"
            strokeWidth={4}
            strokeLinejoin="round"
            style={isTerminus ? { textTransform: "uppercase" } : undefined}
            className="pointer-events-none select-none transition-opacity duration-200"
          >
            {s.name}
          </text>
        );
      })}
    </g>
  );
}
