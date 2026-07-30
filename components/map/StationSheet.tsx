"use client";

import Link from "next/link";
import { LINE_BY_ID, STATIONS } from "@/lib/network/build";
import DisruptionCard from "../DisruptionCard";
import type { Disruption, LineId, StationStatus, StationStatusKind } from "@/lib/types";

// "cut" deliberately avoids "no trains reach here at all": at the model's
// truncation points (Caulfield on Sunbury, Footscray on Pakenham/Cranbourne) a
// cut can really be nearer a boundary, so the copy stays hedged.
const LABEL: Record<StationStatusKind, { text: string; cls: string }> = {
  normal: { text: "Trains running", cls: "text-ok" },
  "no-service": { text: "No timetabled service now", cls: "text-ink-dim" },
  boundary: { text: "Trains terminate here", cls: "text-warn" },
  cut: { text: "Buses replace trains", cls: "text-bad" },
  warning: { text: "Check before you travel", cls: "text-warn" },
};

interface Props {
  stationId: string;
  status: StationStatus;
  disruptions: Disruption[];
  focusedLine: LineId | null;
}

export default function StationSheet({ stationId, status, disruptions, focusedLine }: Props) {
  const station = STATIONS.get(stationId);
  if (!station) return null;

  // `status.status` is the worst state across every line here, which misleads
  // at interchanges — when a line is focused and served here, headline that
  // line's own reading instead (same pattern as MapStations).
  const focusedEntry = focusedLine
    ? status.lines.find((l) => l.lineId === focusedLine)
    : undefined;
  const headline = focusedEntry?.status ?? status.status;
  // Fail-visible: an unmapped disruption must surface even when the headline
  // status is confident. Scope it to the focused line when one applies.
  const unmapped = focusedEntry ? focusedEntry.unmapped : status.unmapped;

  return (
    <div>
      <h2 className="text-base font-extrabold">{station.name}</h2>
      <p className={`mt-1 text-sm font-bold ${LABEL[headline].cls}`}>{LABEL[headline].text}</p>

      {unmapped && (
        <p className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          ⚠ A disruption here couldn&apos;t be fully mapped to a section — check before you
          travel.
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-1.5">
        {status.lines.map((l) => {
          const line = LINE_BY_ID.get(l.lineId);
          if (!line) return null;
          return (
            <li key={l.lineId} className="flex items-center gap-2.5 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: line.color }}
                aria-hidden
              />
              <span className="flex-1">{line.name}</span>
              <span className={`text-xs font-bold ${LABEL[l.status].cls}`}>
                {/* Per-line fail-visible marker, independent of the status. */}
                {l.unmapped && (
                  <span className="text-warn" title="A disruption on this line couldn't be mapped">
                    ⚠{" "}
                  </span>
                )}
                {LABEL[l.status].text}
              </span>
            </li>
          );
        })}
      </ul>

      {disruptions.map((d) => (
        <DisruptionCard key={d.id} d={d} />
      ))}

      <Link
        href={`/calendar?station=${stationId}`}
        className="mt-4 inline-block text-sm font-bold text-accent underline underline-offset-2"
      >
        See the month for {station.name}
      </Link>
    </div>
  );
}
