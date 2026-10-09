// Melbourne timezone helpers shared by scraper and merge logic.

const MEL_TZ = "Australia/Melbourne";

// "2026-07-25 21:00:00" (Melbourne wall clock) -> ISO UTC instant.
// Handles AEST/AEDT via Intl; the ±1h ambiguity at DST transitions is
// irrelevant for disruption windows.
export function melbourneLocalToIso(local: string): string {
  const guess = new Date(local.replace(" ", "T") + "Z");
  const fmt = new Intl.DateTimeFormat("sv", {
    timeZone: MEL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const wall = fmt.format(guess).replace(" ", "T");
  const offsetMs = new Date(wall + "Z").getTime() - guess.getTime();
  return new Date(guess.getTime() - offsetMs).toISOString();
}

// Melbourne calendar date (YYYY-MM-DD) of an ISO instant.
export function melbourneDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: MEL_TZ });
}

// Melbourne wall-clock label of an ISO instant, e.g. "9:30pm".
export function melbourneTimeLabel(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString("en-AU", { timeZone: MEL_TZ, hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s/g, "")
    .toLowerCase();
}

// Today's Melbourne calendar date (YYYY-MM-DD), whatever the server/browser zone.
export function melbourneToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: MEL_TZ });
}

// A <input type="datetime-local"> value ("2026-07-25T21:00") is a wall-clock
// time with no zone. This app is about Melbourne, so read it as Melbourne
// time — not the browser's zone — and return the real instant.
export function melbourneInputToDate(local: string): Date {
  const [date, time = "00:00"] = local.split("T");
  return new Date(melbourneLocalToIso(`${date} ${time.slice(0, 5)}:00`));
}

// Current Melbourne wall clock as a datetime-local value ("2026-07-25T21:00").
export function melbourneNowInput(now = new Date()): string {
  const date = melbourneToday(now);
  const time = now.toLocaleTimeString("en-GB", { timeZone: MEL_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}T${time === "24:00" ? "00:00" : time}`;
}
