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
        const ghosted = focusedLine !== null && focusedLine !== e.lineId;
        return (
          <path
            key={e.id}
            d={pathD(pts)}
            fill="none"
            stroke={line.color}
            strokeWidth={ghosted ? 3 : STROKE}
            strokeOpacity={ghosted ? 0.25 : 1}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-[stroke-width,stroke-opacity] duration-200"
          />
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
