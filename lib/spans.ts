import type { LineId } from "./types";

// Baseline service spans per line, minutes from midnight local (Melbourne).
// `last` may exceed 1440 => service runs past midnight into the next day.
// A `last` of 2880 means service runs continuously into the following
// service day (Night Network on Friday and Saturday nights).
// Approximation of the standard timetable — good enough to answer
// "are there genuinely no trains at 4am Thursday". Refined later via GTFS.

interface DaySpan {
  first: number;
  last: number;
}

// day index: 0=Sun ... 6=Sat (JS convention)
type WeekSpans = [DaySpan, DaySpan, DaySpan, DaySpan, DaySpan, DaySpan, DaySpan];

const METRO_WEEK: WeekSpans = [
  { first: 420, last: 1500 }, // Sun: ~7:00 -> ~1:00
  { first: 290, last: 1500 }, // Mon: ~4:50 -> ~1:00
  { first: 290, last: 1500 }, // Tue
  { first: 290, last: 1500 }, // Wed
  { first: 290, last: 1500 }, // Thu
  { first: 290, last: 2880 }, // Fri: Night Network runs through the night
  { first: 0, last: 2880 }, // Sat: continuous from Fri night, through Sat night
];

const STONY_POINT_WEEK: WeekSpans = [
  { first: 480, last: 1200 }, // Sun ~8:00 -> ~20:00
  { first: 360, last: 1260 },
  { first: 360, last: 1260 },
  { first: 360, last: 1260 },
  { first: 360, last: 1260 },
  { first: 360, last: 1260 },
  { first: 480, last: 1200 },
];

const SPANS: Partial<Record<LineId, WeekSpans>> = {
  "stony-point": STONY_POINT_WEEK,
};

function spansFor(lineId: LineId): WeekSpans {
  return SPANS[lineId] ?? METRO_WEEK;
}

export interface MelTime {
  dateStr: string; // YYYY-MM-DD in Melbourne
  dayOfWeek: number; // 0=Sun..6=Sat in Melbourne
  minutes: number; // minutes since Melbourne midnight
}

const MEL_TZ = "Australia/Melbourne";

export function toMelTime(d: Date): MelTime {
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: MEL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: days.indexOf(parts.weekday),
    minutes: (parseInt(parts.hour, 10) % 24) * 60 + parseInt(parts.minute, 10),
  };
}

// Is the line timetabled to run at this local time?
export function isServiceRunning(lineId: LineId, t: MelTime): boolean {
  const week = spansFor(lineId);
  const today = week[t.dayOfWeek];
  if (t.minutes >= today.first && t.minutes <= Math.min(today.last, 1439)) return true;
  // Early-morning tail of the previous service day.
  const prev = week[(t.dayOfWeek + 6) % 7];
  if (prev.last > 1440 && t.minutes <= prev.last - 1440) return true;
  return false;
}
