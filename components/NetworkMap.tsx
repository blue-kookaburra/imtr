"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { EDGES, STATIONS } from "@/lib/network/build";
import type { Edge, SegmentStatus, StatusResponse } from "@/lib/types";
import { usePanZoom } from "./usePanZoom";
import mapData from "@/data/map-stations.json";

// Base layer: high-res raster of the official Victorian train network map.
// Status overlay: SVG strokes drawn between extracted station coordinates.

const MAP_W = mapData.width as number;
const MAP_H = mapData.height as number;
const COORDS = mapData.stations as unknown as Record<string, [number, number]>;
// Per-edge overlay geometry routed along the map's drawn line artwork.
const EDGE_PATHS = mapData.edges as unknown as Record<string, [number, number][]>;

function pathD(pts: [number, number][]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
}

const WASH = "#eef0f3"; // matches the map's metro-zone background
const NO_SERVICE = "#b7bcc4";
const BLACKOUT = "#31363e";

export interface Selection {
  kind: "edge";
  edge: Edge;
  status: SegmentStatus;
}

interface Props {
  status: StatusResponse | null;
  onSelect: (sel: Selection | null) => void;
}

export default function NetworkMap({ status, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const statusByEdge = useMemo(() => {
    const m = new Map<string, SegmentStatus>();
    for (const s of status?.segments ?? []) m.set(s.edgeId, s);
    return m;
  }, [status]);

  const { t, setT, zoomAt, handlers, wasDrag } = usePanZoom({ x: 0, y: 0, k: 0.2 }, 0.05, 2.5);

  // Fit the metro area (bbox of known stations) on first mount.
  const fitted = useRef(false);
  useLayoutEffect(() => {
    if (fitted.current || !containerRef.current) return;
    fitted.current = true;
    const { clientWidth: w, clientHeight: h } = containerRef.current;
    const xs = Object.values(COORDS).map((p) => p[0]);
    const ys = Object.values(COORDS).map((p) => p[1]);
    const pad = 90;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    // Fit the metro bbox, then lean in toward the city core — full-poster
    // fit is unreadably small on a phone; the rest is a pan away.
    const k = Math.min(w / (maxX - minX), h / (maxY - minY)) * 1.7;
    const loop = COORDS["flinders-street"];
    setT({ k, x: w / 2 - loop[0] * k, y: h / 2 - loop[1] * k });
  }, [setT]);

  function zoomButton(factor: number) {
    const el = containerRef.current;
    if (!el) return;
    zoomAt(el.clientWidth / 2, el.clientHeight / 2, factor);
  }

  function handleEdgeClick(e: Edge) {
    if (wasDrag()) return;
    const st = statusByEdge.get(e.id);
    onSelect(st ? { kind: "edge", edge: e, status: st } : null);
  }

  // Only disrupted edges get overlay art; hit areas exist for every edge.
  const disrupted = useMemo(
    () =>
      EDGES.filter((e) => {
        const st = statusByEdge.get(e.id)?.status;
        return st === "bus-replacement" || st === "no-service";
      }),
    [statusByEdge]
  );

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none overflow-hidden bg-white"
      {...handlers}
    >
      <div
        style={{
          transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})`,
          transformOrigin: "0 0",
          width: MAP_W,
          height: MAP_H,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/network-map.png"
          alt="Victorian train network map"
          width={MAP_W}
          height={MAP_H}
          draggable={false}
          className="pointer-events-none select-none"
        />
        <svg
          className="absolute left-0 top-0"
          width={MAP_W}
          height={MAP_H}
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          aria-hidden
        >
          {disrupted.map((e) => {
            const pts = EDGE_PATHS[e.id];
            if (!pts) return null;
            const d = pathD(pts);
            const st = statusByEdge.get(e.id)!.status;
            return (
              <g key={e.id} fill="none">
                {/* wash hides the printed line colour */}
                <path d={d} stroke={WASH} strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" opacity={0.92} />
                {st === "no-service" && (
                  <path d={d} stroke={NO_SERVICE} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
                )}
                {st === "bus-replacement" && (
                  <>
                    <path d={d} stroke={BLACKOUT} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
                    <path
                      d={d}
                      className="seg-out"
                      stroke="var(--bad)"
                      strokeWidth={4}
                      strokeDasharray="12 12"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </>
                )}
              </g>
            );
          })}
          {/* hit areas over every edge */}
          {EDGES.map((e) => {
            const pts = EDGE_PATHS[e.id];
            if (!pts) return null;
            return (
              <path
                key={e.id}
                d={pathD(pts)}
                fill="none"
                stroke="transparent"
                strokeWidth={30}
                strokeLinecap="round"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={() => handleEdgeClick(e)}
              />
            );
          })}
        </svg>
      </div>

      {/* Zoom controls */}
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

// Referenced by MapScreen for sheet display names.
export { STATIONS };
