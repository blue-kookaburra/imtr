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

export type StationStatusKind =
  | "normal" // trains as timetabled
  | "no-service" // outside timetabled hours — not a fault
  | "warning" // a disruption touches this line but couldn't be parsed
  | "boundary" // trains still reach here from the far side, buses beyond
  | "cut"; // no trains reach here at all

export interface StationLineStatus {
  lineId: LineId;
  status: StationStatusKind;
  // True when a disruption touches this line that the parser could not map to
  // a section. Deliberately separate from `status` so a confident boundary or
  // cut can never hide the fact that something else is unaccounted for — the
  // fail-visible rule applies per line, not just to the strongest signal.
  unmapped: boolean;
}

export interface StationStatus {
  stationId: string;
  // The worst state across every line this station serves — NOT a statement
  // about the station as a whole. At an interchange like Flinders Street one
  // closed line makes this `cut` while eleven others run normally, so UI that
  // wants "is my line running" must read `lines`, not this.
  status: StationStatusKind;
  unmapped: boolean; // any line has an unmapped disruption
  disruptionIds: string[];
  lines: StationLineStatus[];
}

// Normalized disruption produced by the parser.
export interface Disruption {
  id: string; // stable hash of source row
  lineIds: LineId[];
  // Station ids bounding the affected section. Empty + wholeLine=true when unparseable.
  fromStation?: string;
  toStation?: string;
  // All station ids mentioned in the section text. Multi-branch disruptions
  // ("between Parliament, Alamein and Box Hill") span min..max of the ones
  // present on each affected line.
  stations?: string[];
  wholeLine: boolean;
  parsed: boolean; // false => render as warning, never blackout
  // Inclusive date range, local Melbourne dates (YYYY-MM-DD).
  startDate: string;
  endDate: string;
  // Optional daily time window, minutes from midnight local. Absent = all day.
  startMin?: number;
  endMin?: number;
  // Continuous timestamp bounds (ISO) when known (PTV API enrichment).
  // More precise than date range + daily window; takes precedence.
  startTs?: string;
  endTs?: string;
  rawText: string;
  source: "planned-works" | "ptv-api";
  // Official page with full details (line planned-works page or PTV URL).
  url?: string;
}

export interface StatusResponse {
  at: string; // ISO datetime the status is computed for
  generatedAt: string;
  dataUpdatedAt: string; // when scrape cache was last refreshed
  stale: boolean;
  segments: SegmentStatus[];
  stations: StationStatus[];
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
