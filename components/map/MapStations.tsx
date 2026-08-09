"use client";

import { STATIONS } from "@/lib/network/build";
import { RENDERED_STATIONS, STATION_ANGLE, STATION_XY } from "@/lib/map/geometry";
import type { LineId, StationStatus } from "@/lib/types";

interface Props {
  statusByStation: Map<string, StationStatus>;
  focusedLine: LineId | null;
  onSelectStation: (id: string) => void;
}

// Tap target radius in map pixels. Only ~13 CSS px at a phone's initial fit
// (k≈0.24) — station density at overview zoom makes bigger targets impossible;
// it reaches the comfortable 44 CSS px once zoomed past k≈0.85.
const HIT_R = 26;

// Poster draws interchanges as an elongated pill crossing the track bundle
// (stitching the parallel lines together) rather than a plain dot. Purely
// decorative, drawn behind the existing status circles so their colouring
// is untouched.
const CAPSULE_LEN = 28;
const CAPSULE_W = 13;

export default function MapStations({ statusByStation, focusedLine, onSelectStation }: Props) {
  return (
    <g>
      {[...STATIONS.values()].map((s) => {
        if (!RENDERED_STATIONS.has(s.id)) return null;
        const xy = STATION_XY[s.id];
        if (!xy) return null;
        const ghosted = focusedLine !== null && !s.lines.includes(focusedLine);
        const r = s.interchange ? 8 : 6;

        // `status` is the worst state across every line the station serves,
        // which misleads at interchanges (one closed line makes Flinders
        // Street read as "cut" while eleven others run fine). Prefer the
        // focused line's own reading when one is focused; this falls back to
        // the worst-line reading when no line is focused, which is fine — it
        // errs toward showing a problem rather than hiding one.
        const stationStatus = statusByStation.get(s.id);
        const focusedEntry = focusedLine
          ? stationStatus?.lines.find((l) => l.lineId === focusedLine)
          : undefined;
        const st = focusedEntry?.status ?? stationStatus?.status ?? "normal";
        // Fail-visible: a disruption the parser couldn't map to a section
        // must stay visible even when a different line gives this station a
        // confident status. So the warning ring is drawn independently of
        // `st` — a cut station with an unmapped disruption gets both marks.
        const unmapped = focusedEntry?.unmapped ?? stationStatus?.unmapped ?? false;

        return (
          <g key={s.id} opacity={ghosted ? 0.3 : 1} className="transition-opacity duration-200 motion-reduce:transition-none">
            {s.interchange && (
              <rect
                x={xy[0] - CAPSULE_LEN / 2}
                y={xy[1] - CAPSULE_W / 2}
                width={CAPSULE_LEN}
                height={CAPSULE_W}
                rx={CAPSULE_W / 2}
                fill="var(--map-station-fill)"
                stroke="var(--map-station-stroke)"
                strokeWidth={3}
                transform={`rotate(${(STATION_ANGLE[s.id] ?? 0) + 90} ${xy[0]} ${xy[1]})`}
              />
            )}
            {st === "cut" && (
              <circle
                cx={xy[0]}
                cy={xy[1]}
                r={r + 7}
                fill="var(--bad)"
                fillOpacity={0.35}
                className="station-cut"
              />
            )}
            {(st === "warning" || unmapped) && (
              <circle
                cx={xy[0]}
                cy={xy[1]}
                r={r + 6}
                fill="none"
                stroke="var(--warn)"
                strokeWidth={3}
                strokeOpacity={0.7}
              />
            )}
            <circle
              cx={xy[0]}
              cy={xy[1]}
              r={r}
              fill={
                st === "cut"
                  ? "var(--bad)"
                  : st === "boundary"
                    ? "var(--warn)"
                    : st === "no-service"
                      ? "none"
                      : "var(--map-station-fill)"
              }
              stroke={st === "no-service" ? "var(--ink-faint)" : "var(--map-station-stroke)"}
              strokeOpacity={st === "no-service" ? 0.6 : 1}
              strokeWidth={s.interchange ? 4 : 3}
            />
            {/* boundary: trains reach this side only, so fill just half. */}
            {st === "boundary" && (
              <path
                d={`M${xy[0]},${xy[1] - r} A${r},${r} 0 0 0 ${xy[0]},${xy[1] + r} Z`}
                fill="var(--map-station-fill)"
              />
            )}
            <circle
              cx={xy[0]}
              cy={xy[1]}
              r={HIT_R}
              fill="transparent"
              style={{ cursor: "pointer", pointerEvents: "fill" }}
              onClick={() => onSelectStation(s.id)}
            />
          </g>
        );
      })}
    </g>
  );
}
