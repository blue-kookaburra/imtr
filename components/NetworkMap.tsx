"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { EDGES, LINE_BY_ID, LINE_DEFS, stationList } from "@/lib/network/build";
import { ANCHORS, CITY_LOOP } from "@/lib/network/data";
import type { Edge, SegmentStatus, StatusResponse } from "@/lib/types";
import { usePanZoom } from "./usePanZoom";

const S = 44; // schematic unit -> px

export interface Selection {
  kind: "edge";
  edge: Edge;
  status: SegmentStatus;
}

interface Props {
  status: StatusResponse | null;
  onSelect: (sel: Selection | null) => void;
}

function px(v: number) {
  return v * S;
}

// Parallel lines sharing a station pair are offset perpendicular to the edge.
function edgeOffsets(): Map<string, number> {
  const groups = new Map<string, Edge[]>();
  for (const e of EDGES) {
    const key = [e.from, e.to].sort().join("|");
    const g = groups.get(key) ?? [];
    g.push(e);
    groups.set(key, g);
  }
  const offsets = new Map<string, number>();
  for (const g of groups.values()) {
    g.forEach((e, i) => offsets.set(e.id, (i - (g.length - 1) / 2) * 4.5));
  }
  return offsets;
}

export default function NetworkMap({ status, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stations = useMemo(() => stationList(), []);
  const offsets = useMemo(() => edgeOffsets(), []);
  const statusByEdge = useMemo(() => {
    const m = new Map<string, SegmentStatus>();
    for (const s of status?.segments ?? []) m.set(s.edgeId, s);
    return m;
  }, [status]);
  const warnedLines = useMemo(
    () => new Set(status?.lineWarnings.map((w) => w.lineId) ?? []),
    [status]
  );

  const stationXY = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const s of stations) m.set(s.id, { x: px(s.x), y: px(s.y) });
    return m;
  }, [stations]);

  const { t, setT, zoomAt, handlers, wasDrag } = usePanZoom({ x: 0, y: 0, k: 1 });

  function zoomButton(factor: number) {
    const el = containerRef.current;
    if (!el) return;
    zoomAt(el.clientWidth / 2, el.clientHeight / 2, factor);
  }

  // Fit the whole network to the container on first mount.
  const fitted = useRef(false);
  useLayoutEffect(() => {
    if (fitted.current || !containerRef.current) return;
    fitted.current = true;
    const { clientWidth: w, clientHeight: h } = containerRef.current;
    const xs = [...stationXY.values()].map((p) => p.x);
    const ys = [...stationXY.values()].map((p) => p.y);
    const pad = 60;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    const k = Math.min(w / (maxX - minX), h / (maxY - minY));
    // Transform applies translate(x,y) scale(k) to schematic coords.
    setT({
      k,
      x: (w - (minX + maxX) * k) / 2,
      y: (h - (minY + maxY) * k) / 2,
    });
  }, [stationXY, setT]);

  // Zoom tiers: overview shows termini labels + major dots only; mid shows
  // all dots + major labels; close shows everything.
  const showAllDots = t.k > 0.45;
  const showMajorLabels = t.k > 0.45;
  const showMinorLabels = t.k > 0.9;
  // Counter-scale factor: keeps strokes/labels near screen size while zooming
  // (sqrt so zooming in still grows things somewhat).
  const z = 1 / Math.sqrt(t.k);

  const termini = useMemo(() => new Set(LINE_DEFS.map((l) => l.stations[l.stations.length - 1])), []);

  // Loop-only stations (Flagstaff etc.) aren't on any line path, so their
  // coords come straight from the anchor table.
  const loopPath = useMemo(() => {
    const pts = CITY_LOOP.map((id) => ({ x: px(ANCHORS[id][0]), y: px(ANCHORS[id][1]) }));
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
  }, []);

  const loopOnlyStations = useMemo(
    () =>
      CITY_LOOP.filter((id) => !stationXY.has(id)).map((id) => ({
        id,
        name: id
          .split("-")
          .map((w) => w[0].toUpperCase() + w.slice(1))
          .join(" "),
        x: px(ANCHORS[id][0]),
        y: px(ANCHORS[id][1]),
      })),
    [stationXY]
  );

  function segLine(e: Edge) {
    const a = stationXY.get(e.from)!;
    const b = stationXY.get(e.to)!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = offsets.get(e.id) ?? 0;
    const ox = (-dy / len) * off;
    const oy = (dx / len) * off;
    return { x1: a.x + ox, y1: a.y + oy, x2: b.x + ox, y2: b.y + oy };
  }

  function handleEdgeClick(e: Edge) {
    if (wasDrag()) return;
    const st = statusByEdge.get(e.id);
    onSelect(st ? { kind: "edge", edge: e, status: st } : null);
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none overflow-hidden board-glow"
      {...handlers}
    >
      <svg className="h-full w-full" role="img" aria-label="Melbourne train network status map">
        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
          {/* City Loop ring */}
          <path d={loopPath} fill="none" stroke="var(--hairline)" strokeWidth={10 * z} strokeLinejoin="round" />

          {/* Edges: ghost base + status strokes */}
          {EDGES.map((e) => {
            const l = segLine(e);
            const line = LINE_BY_ID.get(e.lineId)!;
            const st = statusByEdge.get(e.id)?.status ?? "running";
            const warned = warnedLines.has(e.lineId);
            return (
              <g key={e.id}>
                {/* ghost base — the network is always faintly visible */}
                <line {...l} stroke={line.color} strokeWidth={4 * z} opacity={0.16} strokeLinecap="round" />
                {st === "running" && (
                  <line
                    {...l}
                    stroke={line.color}
                    strokeWidth={4 * z}
                    strokeLinecap="round"
                    opacity={warned ? 0.55 : 1}
                  />
                )}
                {st === "bus-replacement" && (
                  <>
                    <line {...l} stroke="var(--blackout)" strokeWidth={5 * z} strokeLinecap="round" />
                    <line
                      {...l}
                      className="seg-out"
                      stroke="var(--bad)"
                      strokeWidth={2.5 * z}
                      strokeDasharray={`${7 * z} ${7 * z}`}
                      strokeLinecap="round"
                    />
                  </>
                )}
                {st === "no-service" && (
                  <line {...l} stroke="var(--blackout)" strokeWidth={4 * z} strokeLinecap="round" opacity={0.9} />
                )}
                {/* fat invisible hit area */}
                <line
                  {...l}
                  stroke="transparent"
                  strokeWidth={16 * z}
                  strokeLinecap="round"
                  style={{ cursor: "pointer" }}
                  onClick={() => handleEdgeClick(e)}
                />
              </g>
            );
          })}

          {/* City Loop-only stations */}
          {loopOnlyStations.map((s) => (
            <g key={s.id}>
              <circle cx={s.x} cy={s.y} r={4 * z} fill="var(--bg)" stroke="var(--ink)" strokeWidth={1.8 * z} />
              {showMajorLabels && (
                <text
                  x={s.x + 8 * z}
                  y={s.y - 6 * z}
                  fontSize={10 * z}
                  fontWeight={700}
                  fill="var(--ink)"
                  style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 3 * z }}
                >
                  {s.name}
                </text>
              )}
            </g>
          ))}

          {/* Stations */}
          {stations.map((s) => {
            const p = stationXY.get(s.id)!;
            const isTerminus = termini.has(s.id);
            const major = s.interchange || isTerminus;
            if (!major && !showAllDots) return null;
            const labelled =
              (isTerminus) || (s.interchange && showMajorLabels) || showMinorLabels;
            return (
              <g key={s.id}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={(major ? 4.5 : 2.6) * z}
                  fill="var(--bg)"
                  stroke="var(--ink)"
                  strokeWidth={(major ? 2 : 1.3) * z}
                />
                {labelled && (
                  <text
                    x={p.x + (p.x > 400 ? -8 : 8) * z}
                    y={p.y - 6 * z}
                    textAnchor={p.x > 400 ? "end" : "start"}
                    fontSize={(major ? 11 : 9) * z}
                    fontWeight={major ? 700 : 400}
                    fill={major ? "var(--ink)" : "var(--ink-dim)"}
                    style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 3 * z }}
                  >
                    {s.name}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Zoom controls */}
      <div className="absolute bottom-16 right-3 flex flex-col overflow-hidden rounded-xl border border-hairline bg-elevated/90 backdrop-blur">
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
