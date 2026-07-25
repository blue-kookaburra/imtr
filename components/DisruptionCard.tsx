"use client";

import type { Disruption } from "@/lib/types";

function dayLabel(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function tsLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function minLabel(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const ap = h24 >= 12 ? "pm" : "am";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h}${ap}` : `${h}:${String(m).padStart(2, "0")}${ap}`;
}

export default function DisruptionCard({ d }: { d: Disruption }) {
  const hasTs = !!(d.startTs || d.endTs);
  const hasWindow = d.startMin !== undefined || d.endMin !== undefined;
  return (
    <div className="mt-3 rounded-lg border border-hairline bg-bg p-3.5">
      <p className="tabular text-sm font-bold text-accent">
        {hasTs ? (
          <>
            {d.startTs && tsLabel(d.startTs)}
            {d.endTs && <> → {tsLabel(d.endTs)}</>}
          </>
        ) : (
          <>
            {dayLabel(d.startDate)}
            {d.endDate !== d.startDate && <> – {dayLabel(d.endDate)}</>}
            {hasWindow && (
              <>
                {" · "}
                {d.startMin !== undefined && `from ${minLabel(d.startMin)}`}
                {d.startMin !== undefined && d.endMin !== undefined && " "}
                {d.endMin !== undefined && `until ${minLabel(d.endMin)}`}
              </>
            )}
          </>
        )}
      </p>
      <p className="mt-1.5 text-sm leading-snug">{d.rawText}</p>
      {!hasTs && !hasWindow && (
        <p className="mt-1.5 text-xs leading-snug text-ink-dim">
          Start and end times within these days aren&apos;t published here — trains may still run
          part of the day.
        </p>
      )}
      {d.url && (
        <a
          href={d.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-xs font-bold text-accent underline underline-offset-2"
        >
          Official details ↗
        </a>
      )}
    </div>
  );
}
