import type { Edge, LineDef, LineId, Station } from "../types";
import { ANCHORS, ARMS, LINES, LOOP, NAME_OVERRIDES, type XY } from "./data";

function titleCase(id: string): string {
  return (
    NAME_OVERRIDES[id] ??
    id
      .split("-")
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ")
  );
}

function computeCoords(): Record<string, XY> {
  const coords: Record<string, XY> = { ...ANCHORS };
  for (const [fromId, toId, mids] of ARMS) {
    const a = coords[fromId];
    const b = coords[toId];
    if (!a || !b) throw new Error(`Arm anchors missing: ${fromId} -> ${toId}`);
    mids.forEach((id, i) => {
      const t = (i + 1) / (mids.length + 1);
      coords[id] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    });
  }
  return coords;
}

function buildAll() {
  const coords = computeCoords();
  const stations = new Map<string, Station>();
  const edges: Edge[] = [];

  for (const line of LINES) {
    for (const id of line.stations) {
      const xy = coords[id];
      if (!xy) throw new Error(`No coordinates for station ${id} (line ${line.id})`);
      const existing = stations.get(id);
      if (existing) {
        if (!existing.lines.includes(line.id)) existing.lines.push(line.id);
      } else {
        stations.set(id, {
          id,
          name: titleCase(id),
          lines: [line.id],
          x: xy[0],
          y: xy[1],
          interchange: false,
        });
      }
    }
    for (let i = 0; i < line.stations.length - 1; i++) {
      const from = line.stations[i];
      const to = line.stations[i + 1];
      edges.push({ id: `${line.id}:${from}-${to}`, lineId: line.id, from, to });
    }
  }

  // City Loop overlay. Adds ring stations and per-line ring edges without
  // touching the line arrays. The loop chain runs Flinders Street -> the
  // group's ring order -> the group's portal on its own trunk, so it is
  // parallel to (never a replacement for) the direct city edges above.
  for (const group of LOOP.groups) {
    const chain = ["flinders-street", ...group.order, group.portal];
    for (const lineId of group.lines) {
      for (const id of chain) {
        const existing = stations.get(id);
        if (existing) {
          if (!existing.lines.includes(lineId)) existing.lines.push(lineId);
        } else {
          // Loop-only stations have no schematic coordinate. ANCHORS/ARMS are
          // legacy anyway — the map renders from data/map-geometry.json, which
          // carries real poster coordinates for all three.
          stations.set(id, {
            id,
            name: titleCase(id),
            lines: [lineId],
            x: 0,
            y: 0,
            interchange: false,
          });
        }
      }
      for (let i = 0; i < chain.length - 1; i++) {
        edges.push({
          id: `${lineId}:${chain[i]}-${chain[i + 1]}`,
          lineId,
          from: chain[i],
          to: chain[i + 1],
        });
      }
    }
  }

  for (const s of stations.values()) {
    // Interchange = served by lines of more than one colour group.
    const colors = new Set(s.lines.map((l) => LINES.find((d) => d.id === l)!.color));
    s.interchange = colors.size > 1;
  }

  return { stations, edges };
}

const built = buildAll();

export const STATIONS: Map<string, Station> = built.stations;
export const EDGES: Edge[] = built.edges;
export const LINE_DEFS: LineDef[] = LINES;
export const LINE_BY_ID: Map<LineId, LineDef> = new Map(LINES.map((l) => [l.id, l]));

// The order used to decide which stations a disruption's section covers.
// Distinct from both the drawn geometry and the LINES arrays: a loop-served
// line's section can run through the ring, so the ring is spliced in ahead of
// the trunk. Non-loop lines are just their trunk.
const MATCH_SEQUENCES = new Map<LineId, string[]>(
  LINES.map((line) => {
    const group = LOOP.groups.find((g) => g.lines.includes(line.id));
    if (!group) return [line.id, line.stations];
    return [line.id, [line.stations[0], ...group.order, ...line.stations.slice(1)]];
  })
);

export function matchSequence(lineId: LineId): string[] {
  return MATCH_SEQUENCES.get(lineId) ?? [];
}

export function stationList(): Station[] {
  return [...STATIONS.values()];
}

// Edges for a line between two stations (inclusive span), used to map
// "buses replace trains between X and Y" onto map segments.
export function edgesBetween(lineId: LineId, a: string, b: string): Edge[] {
  const seq = matchSequence(lineId);
  const ia = seq.indexOf(a);
  const ib = seq.indexOf(b);
  if (ia === -1 || ib === -1) return [];
  const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
  return EDGES.filter((e) => {
    if (e.lineId !== lineId) return false;
    const i = seq.indexOf(e.from);
    return i >= lo && i < hi;
  });
}

// All edges of a line.
export function lineEdges(lineId: LineId): Edge[] {
  return EDGES.filter((e) => e.lineId === lineId);
}

// Station name -> id lookup tolerant of case/punctuation, for parser use.
const nameIndex = new Map<string, string>();
for (const s of STATIONS.values()) {
  nameIndex.set(s.name.toLowerCase(), s.id);
  nameIndex.set(s.id, s.id);
}
export function findStationId(name: string): string | undefined {
  return nameIndex.get(name.trim().toLowerCase().replace(/\s+station$/, ""));
}
