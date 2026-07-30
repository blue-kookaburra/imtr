"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { EDGES, STATIONS } from "@/lib/network/build";
import { MAP_H, MAP_W, STATION_XY } from "@/lib/map/geometry";
import type { Edge, LineId, SegmentStatus, StationStatus, StatusResponse } from "@/lib/types";
import { usePanZoom } from "./usePanZoom";
import MapLines from "./map/MapLines";
import MapStations from "./map/MapStations";
import MapLabels from "./map/MapLabels";

export type Selection =
  | { kind: "edge"; edge: Edge; status: SegmentStatus }
  | { kind: "station"; stationId: string; status: StationStatus };

interface Props {
  status: StatusResponse | null;
  focusedLine: LineId | null;
  onSelect: (sel: Selection | null) => void;
}

export default function NetworkMap({ status, focusedLine, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const statusByEdge = useMemo(() => {
    const m = new Map<string, SegmentStatus>();
    for (const s of status?.segments ?? []) m.set(s.edgeId, s);
    return m;
  }, [status]);

  const statusByStation = useMemo(() => {
    const m = new Map<string, StationStatus>();
    for (const s of status?.stations ?? []) m.set(s.stationId, s);
    return m;
  }, [status]);

  const { t, setT, zoomAt, handlers, wasDrag } = usePanZoom({ x: 0, y: 0, k: 0.2 }, 0.05, 2.5);

  // Fit the metro bbox on first mount, then lean in toward the city core — a
  // full-poster fit is unreadably small on a phone; the rest is a pan away.
  const fitted = useRef(false);
  useLayoutEffect(() => {
    if (fitted.current || !containerRef.current) return;
    fitted.current = true;
    const { clientWidth: w, clientHeight: h } = containerRef.current;
    const xs = Object.values(STATION_XY).map((p) => p[0]);
    const ys = Object.values(STATION_XY).map((p) => p[1]);
    const pad = 90;
    const spanX = Math.max(...xs) - Math.min(...xs) + pad * 2;
    const spanY = Math.max(...ys) - Math.min(...ys) + pad * 2;
    const k = Math.min(w / spanX, h / spanY) * 1.7;
    const loop = STATION_XY["flinders-street"];
    setT({ k, x: w / 2 - loop[0] * k, y: h / 2 - loop[1] * k });
  }, [setT]);

  function zoomButton(factor: number) {
    const el = containerRef.current;
    if (!el) return;
    zoomAt(el.clientWidth / 2, el.clientHeight / 2, factor);
  }

  function handleEdge(e: Edge) {
    if (wasDrag()) return;
    const st = statusByEdge.get(e.id);
    onSelect(st ? { kind: "edge", edge: e, status: st } : null);
  }

  function handleStation(id: string) {
    if (wasDrag()) return;
    const st = statusByStation.get(id);
    onSelect(st ? { kind: "station", stationId: id, status: st } : null);
  }

  return (
    <div
      ref={containerRef}
      className="map-canvas relative h-full w-full touch-none overflow-hidden"
      {...handlers}
    >
      <svg
        width={MAP_W}
        height={MAP_H}
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        style={{
          transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})`,
          transformOrigin: "0 0",
        }}
      >
        <MapLines statusByEdge={statusByEdge} focusedLine={focusedLine} onSelectEdge={handleEdge} />
        <MapStations
          statusByStation={statusByStation}
          focusedLine={focusedLine}
          onSelectStation={handleStation}
        />
        <MapLabels statusByStation={statusByStation} focusedLine={focusedLine} zoom={t.k} />
      </svg>

      <div className="absolute bottom-16 right-3 flex flex-col overflow-hidden rounded-xl border border-hairline bg-elevated/95 backdrop-blur">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => zoomButton(1.4)}
          className="flex h-11 w-11 items-center justify-center text-xl font-bold text-ink-dim transition-colors duration-150 hover:text-ink cursor-pointer"
        >
          +
        </button>
        <div className="mx-2 h-px bg-hairline" aria-hidden />
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoomButton(1 / 1.4)}
          className="flex h-11 w-11 items-center justify-center text-xl font-bold text-ink-dim transition-colors duration-150 hover:text-ink cursor-pointer"
        >
          −
        </button>
      </div>
    </div>
  );
}

export { STATIONS, EDGES };
