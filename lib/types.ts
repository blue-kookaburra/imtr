// Core domain types shared by scraper, merge logic, API and UI.

export type LineId =
  | "werribee"
  | "williamstown"
  | "sunbury"
  | "craigieburn"
  | "upfield"
  | "mernda"
  | "hurstbridge"
  | "belgrave"
  | "lilydale"
  | "alamein"
  | "glen-waverley"
  | "pakenham"
  | "cranbourne"
  | "frankston"
  | "sandringham"
  | "stony-point";

export interface Station {
  id: string; // kebab-case, e.g. "yarraville"
  name: string; // display name, e.g. "Yarraville"
  lines: LineId[];
  x: number; // schematic coords
  y: number;
  interchange: boolean; // label emphasis on map
}

// One station-to-station link on a line.
export interface Edge {
  id: string; // `${lineId}:${fromId}-${toId}`
  lineId: LineId;
  from: string;
  to: string;
}

export interface LineDef {
  id: LineId;
  name: string;
  color: string; // official PTV group colour
  stations: string[]; // ordered station ids, city end first
}

export type SegmentStatusKind =
  | "running"
  | "no-service" // outside timetabled hours
  | "bus-replacement"
  | "warning"; // disruption exists but couldn't be parsed to segments

export interface SegmentStatus {
  edgeId: string;
  status: SegmentStatusKind;
  disruptionIds: string[];
}

// Normalized disruption produced by the parser.
export interface Disruption {
  id: string; // stable hash of source row
  lineIds: LineId[];
  // Station ids bounding the affected section. Empty + wholeLine=true when unparseable.
  fromStation?: string;
  toStation?: string;
  wholeLine: boolean;
  parsed: boolean; // false => render as warning, never blackout
  // Inclusive date range, local Melbourne dates (YYYY-MM-DD).
  startDate: string;
  endDate: string;
  // Optional daily time window, minutes from midnight local. Absent = all day.
  startMin?: number;
  endMin?: number;
  rawText: string;
  source: "planned-works" | "ptv-api";
}

export interface StatusResponse {
  at: string; // ISO datetime the status is computed for
  generatedAt: string;
  dataUpdatedAt: string; // when scrape cache was last refreshed
  stale: boolean;
  segments: SegmentStatus[];
  lineWarnings: { lineId: LineId; disruptionIds: string[] }[];
  disruptions: Disruption[];
}

export type DayStatusKind = "normal" | "partial" | "disrupted" | "no-data";

export interface DayStatus {
  date: string; // YYYY-MM-DD
  status: DayStatusKind;
  summary?: string; // e.g. "Buses replace trains after 8:20pm"
  disruptionIds: string[];
}

export interface CalendarResponse {
  stationId: string;
  from: string;
  to: string;
  dataUpdatedAt: string;
  days: DayStatus[];
  disruptions: Disruption[];
}
