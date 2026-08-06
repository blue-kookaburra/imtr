"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { CalendarResponse, DayStatus } from "@/lib/types";
import { STATIONS } from "@/lib/network/build";
import Logo from "./Logo";
import StationSearch from "./StationSearch";
import BottomSheet from "./BottomSheet";
import DisruptionCard from "./DisruptionCard";

const DAY_CLS: Record<DayStatus["status"], string> = {
  normal: "bg-ok/15 text-ok",
  partial: "bg-warn/20 text-warn",
  disrupted: "bg-bad/25 text-bad",
  "no-data": "bg-elevated text-ink-faint",
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Today's date in Melbourne, regardless of the viewer's timezone.
function melbourneToday(): { str: string; year: number; month: number } {
  const str = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
  const [y, m] = str.split("-").map(Number);
  return { str, year: y, month: m - 1 };
}

function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function CalendarScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const stationId = params.get("station");

  const today = useMemo(() => melbourneToday(), []);
  const [view, setView] = useState({ year: today.year, month: today.month });
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [selDay, setSelDay] = useState<DayStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const setStation = useCallback(
    (id: string) => router.replace(`/calendar?station=${id}`),
    [router]
  );

  useEffect(() => {
    if (!stationId || !STATIONS.has(stationId)) return;
    const from = ymd(new Date(Date.UTC(view.year, view.month, 1)));
    const to = ymd(new Date(Date.UTC(view.year, view.month + 1, 0)));
    setLoading(true);
    fetch(`/api/station/${stationId}/calendar?from=${from}&to=${to}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [stationId, view]);

  const station = stationId ? STATIONS.get(stationId) : null;
  const dayMap = useMemo(
    () => new Map((data?.days ?? []).map((d) => [d.date, d])),
    [data]
  );

  // Month grid cells: leading blanks (Mon-first week) + days.
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(view.year, view.month, 1));
    const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7; // Monday-first
    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      out.push(ymd(new Date(Date.UTC(view.year, view.month, d))));
    }
    return out;
  }, [view]);

  const atLimit =
    view.year > today.year || (view.year === today.year && view.month >= today.month + 2);
  const atStart =
    view.year < today.year || (view.year === today.year && view.month <= today.month);

  function shiftMonth(dir: 1 | -1) {
    setView((v) => {
      const m = v.month + dir;
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }

  const todayStr = today.str;

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-hairline bg-elevated/95 px-4 pt-[calc(env(safe-area-inset-top)+10px)] pb-3 backdrop-blur">
        <div className="mx-auto max-w-md">
          {/* Same mark, size and position as the Map header, so the two read as
              one app rather than two screens that happen to share a tab bar. */}
          <div className="mb-2 flex items-center gap-2.5">
            <Logo className="h-8 w-auto shrink-0 text-ink" />
            <h1 className="text-[15px] font-extrabold leading-tight tracking-tight">
              Disruptions by station
            </h1>
          </div>
          <StationSearch value={stationId} onChange={setStation} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="mx-auto max-w-md">
          {!station && (
            <div className="mt-16 text-center">
              <p className="text-sm text-ink-dim">
                Pick your station to see a month of disruptions at a glance.
              </p>
            </div>
          )}

          {station && (
            <>
              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  disabled={atStart}
                  aria-label="Previous month"
                  className="rounded-lg border border-hairline px-3.5 py-2 text-sm font-bold text-ink-dim disabled:opacity-30 cursor-pointer disabled:cursor-default"
                >
                  ‹
                </button>
                <h2 className="tabular text-sm font-bold uppercase tracking-widest">
                  {monthLabel(view.year, view.month)}
                </h2>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  disabled={atLimit}
                  aria-label="Next month"
                  className="rounded-lg border border-hairline px-3.5 py-2 text-sm font-bold text-ink-dim disabled:opacity-30 cursor-pointer disabled:cursor-default"
                >
                  ›
                </button>
              </div>

              <div className="mt-3 grid grid-cols-7 gap-1.5 text-center">
                {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                  <div key={i} className="pb-1 text-[10px] font-bold uppercase text-ink-faint">
                    {d}
                  </div>
                ))}
                {cells.map((date, i) =>
                  date === null ? (
                    <div key={`b${i}`} />
                  ) : (
                    (() => {
                      const day = dayMap.get(date);
                      const status = day?.status ?? "no-data";
                      const isPast = date < todayStr;
                      return (
                        <button
                          key={date}
                          type="button"
                          onClick={() => day && !isPast && setSelDay(day)}
                          disabled={isPast || !day}
                          aria-label={`${date}: ${status}`}
                          className={`tabular aspect-square rounded-lg text-sm font-semibold transition-transform duration-100 active:scale-95 ${
                            isPast ? "bg-transparent text-ink-faint/40" : DAY_CLS[status]
                          } ${date === todayStr ? "ring-2 ring-accent" : ""} ${
                            !isPast && day ? "cursor-pointer" : ""
                          } ${loading ? "opacity-50" : ""}`}
                        >
                          {parseInt(date.slice(8), 10)}
                        </button>
                      );
                    })()
                  )
                )}
              </div>

              <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[10px] font-semibold uppercase tracking-wider text-ink-dim">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded bg-ok/40" /> Normal
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded bg-warn/50" /> Part of day
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded bg-bad/50" /> Buses / closed
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded bg-elevated ring-1 ring-hairline" /> No data
                  yet
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <BottomSheet open={!!selDay} onClose={() => setSelDay(null)}>
        {selDay && station && (
          <div>
            <h2 className="text-base font-extrabold">
              {station.name} ·{" "}
              <span className="tabular font-bold text-ink-dim">
                {new Date(selDay.date + "T00:00:00").toLocaleDateString("en-AU", {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </h2>
            {selDay.status === "normal" && (
              <p className="mt-3 text-sm text-ok">No planned disruptions. Trains as usual.</p>
            )}
            {selDay.status === "no-data" && (
              <p className="mt-3 text-sm text-ink-dim">
                Too far ahead — planned works are published about four weeks out.
              </p>
            )}
            {(selDay.status === "partial" || selDay.status === "disrupted") && (
              <>
                {(data?.disruptions ?? [])
                  .filter((d) => selDay.disruptionIds.includes(d.id))
                  .map((d) => (
                    <DisruptionCard key={d.id} d={d} />
                  ))}
                <Link
                  href={`/?at=${selDay.date}T12:00`}
                  className="mt-4 inline-block text-sm font-bold text-accent underline underline-offset-2"
                >
                  See it on the map →
                </Link>
              </>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
