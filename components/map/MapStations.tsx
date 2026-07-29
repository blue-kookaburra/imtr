"use client";

import { STATIONS } from "@/lib/network/build";
import { RENDERED_STATIONS, STATION_XY } from "@/lib/map/geometry";
import type { LineId, StationStatus } from "@/lib/types";

interface Props {
  statusByStation: Map<string, StationStatus>;
  focusedLine: LineId | null;
  onSelectStation: (id: string) => void;
}

// Tap target radius in map pixels. At the app's default zoom this is a little
// over 44 CSS px, which is the minimum comfortable touch target.
const HIT_R = 26;

export default function MapStations({ statusByStation, focusedLine, onSelectStation }: Props) {
  return (
    <g>
      {[...STATIONS.values()].map((s) => {
        if (!RENDERED_STATIONS.has(s.id)) return null;
        const xy = STATION_XY[s.id];
        if (!xy) return null;
        const ghosted = focusedLine !== null && !s.lines.includes(focusedLine);
        const r = s.interchange ? 8 : 6;
        return (
          <g key={s.id} opacity={ghosted ? 0.3 : 1} className="transition-opacity duration-200 motion-reduce:transition-none">
            <circle
              cx={xy[0]}
              cy={xy[1]}
              r={r}
              fill="var(--map-station-fill)"
              stroke="var(--map-station-stroke)"
              strokeWidth={s.interchange ? 4 : 3}
            />
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
