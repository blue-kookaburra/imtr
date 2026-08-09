// Typed access to the generated map geometry. Regenerate with `npm run map:build`.
import geometry from "@/data/map-geometry.json";

export type XY = [number, number];

export const MAP_W = geometry.width as number;
export const MAP_H = geometry.height as number;
export const STATION_XY = geometry.stations as unknown as Record<string, XY>;
export const EDGE_PATH = geometry.edges as unknown as Record<string, XY[]>;

// How far the build had to drag each polyline's ends to reach its stations.
// Small = the parallel-lane tick the poster draws. Large = the polyline was
// routed somewhere else and needs a hand-authored replacement.
export const SNAP_DISTANCE = geometry.snapped as unknown as Record<string, number>;

// Stations that belong to at least one edge, so can be drawn and given a status.
export const RENDERED_STATIONS: ReadonlySet<string> = new Set(geometry.rendered as string[]);

// Stations with coordinates but no edges — the City Loop, which the network
// model in lib/network/data.ts does not cover. Deliberately not drawn.
export const ORPHAN_STATIONS: ReadonlySet<string> = new Set(geometry.orphans as string[]);

// SVG path data for a polyline.
export function pathD(pts: XY[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
}

export type LabelAnchor = "start" | "middle" | "end";
export interface LabelPlacement {
  dx: number;
  dy: number;
  anchor: LabelAnchor;
  // Tilt to follow a steep diagonal line (non-interchange stations only) —
  // set by build_map_geometry.ts, absent otherwise.
  angle?: number;
}

export const LABEL_PLACEMENT = geometry.labels as unknown as Record<string, LabelPlacement>;

// Local track angle (degrees, -90..90) at each rendered station. Used to
// orient interchange capsules perpendicular to the bundle they sit on.
export const STATION_ANGLE = geometry.stationAngle as unknown as Record<string, number>;
