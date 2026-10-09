import type { Disruption } from "./types";

// Can `newer` (an article or live record with exact times) stand in for
// `older` (a whole-date forecast row)? Same lines and overlapping dates — but
// if both name stations and share none, they are different works on the same
// line, and dropping the older one would hide a real disruption (a false
// all-clear). When either side names no stations we can't tell, so the older
// row is still replaced, as before.
export function supersedes(newer: Disruption, older: Disruption): boolean {
  if (newer.startDate > older.endDate || newer.endDate < older.startDate) return false;
  if (!older.lineIds.every((id) => newer.lineIds.includes(id))) return false;
  if (newer.stations?.length && older.stations?.length) {
    return older.stations.some((s) => newer.stations!.includes(s));
  }
  return true;
}
