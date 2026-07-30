// The map is a time machine, so the canvas answers to the time being queried
// rather than the wall clock or an OS setting.

export type MapTheme = "day" | "dusk" | "night";

const MEL_TZ = "Australia/Melbourne";

// Melbourne wall-clock hour (0-23) of an instant.
function melbourneHour(at: Date): number {
  const hh = new Intl.DateTimeFormat("en-GB", {
    timeZone: MEL_TZ,
    hour: "2-digit",
    hour12: false,
  }).format(at);
  return Number(hh);
}

export function mapThemeFor(at: Date): MapTheme {
  const h = melbourneHour(at);
  if (h >= 7 && h < 18) return "day";
  if ((h >= 18 && h < 20) || (h >= 5 && h < 7)) return "dusk";
  return "night";
}
