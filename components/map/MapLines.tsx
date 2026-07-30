"use client";

import { EDGES, LINE_BY_ID } from "@/lib/network/build";
import { EDGE_PATH, pathD } from "@/lib/map/geometry";
import type { Edge, LineId, SegmentStatus } from "@/lib/types";

interface Props {
  statusByEdge: Map<string, SegmentStatus>;
  focusedLine: LineId | null;
  onSelectEdge: (e: Edge) => void;
}

const STROKE = 11;

export default function MapLines({ statusByEdge, focusedLine, onSelectEdge }: Props) {
  return (
    <g>
      {EDGES.map((e) => {
        const pts = EDGE_PATH[e.id];
        if (!pts) return null;
        const line = LINE_BY_ID.get(e.lineId);
        if (!line) return null;
        const d = pathD(pts);
        const st = statusByEdge.get(e.id)?.status ?? "running";
        const ghosted = focusedLine !== null && focusedLine !== e.lineId;
        const w = ghosted ? 3 : STROKE;
        const o = ghosted ? 0.25 : 1;

        // bus-replacement: the stroke severs. A dashed bus path bridges the gap
        // and the line's own colour is kept, so the break reads as this line
        // failing rather than a patch laid over it.
        if (st === "bus-replacement") {
          return (
            <g key={e.id} fill="none" strokeOpacity={o}>
              <path
                d={d}
                stroke={line.color}
                strokeWidth={w}
                strokeOpacity={0.28}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={d}
                className="seg-out"
                stroke={line.color}
                strokeWidth={w}
                strokeDasharray="18 22"
                strokeLinecap="butt"
                strokeLinejoin="round"
              />
            </g>
          );
        }

        // no-service: a thin dotted ghost in the line's own hue. Not a fault —
        // just nothing timetabled right now.
        if (st === "no-service") {
          return (
            <path
              key={e.id}
              d={d}
              fill="none"
              stroke={line.color}
              strokeWidth={Math.max(2, w * 0.35)}
              strokeOpacity={o * 0.45}
              strokeDasharray="2 14"
              strokeLinecap="round"
            />
          );
        }

        // warning: full colour plus a halo. Never a blackout, never an
        // all-clear — the fail-visible rule.
        return (
          <g key={e.id} fill="none">
            {st === "warning" && (
              <path
                d={d}
                stroke="var(--warn)"
                strokeWidth={w + 10}
                strokeOpacity={o * 0.3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            <path
              d={d}
              stroke={line.color}
              strokeWidth={w}
              strokeOpacity={o}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-[stroke-width,stroke-opacity] duration-200 motion-reduce:transition-none"
            />
          </g>
        );
      })}

      {/* Invisible fat paths carry the taps. Drawn after the visible strokes so
          they sit on top, but below the station targets added by MapStations. */}
      {EDGES.map((e) => {
        const pts = EDGE_PATH[e.id];
        if (!pts) return null;
        return (
          <path
            key={`hit-${e.id}`}
            d={pathD(pts)}
            fill="none"
            stroke="transparent"
            strokeWidth={30}
            strokeLinecap="round"
            style={{ cursor: "pointer", pointerEvents: "stroke" }}
            onClick={() => onSelectEdge(e)}
          />
        );
      })}
    </g>
  );
}
