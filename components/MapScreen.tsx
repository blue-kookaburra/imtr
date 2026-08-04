"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { LineId, StatusResponse } from "@/lib/types";
import { LINE_BY_ID, STATIONS } from "@/lib/network/build";
import { mapThemeFor } from "@/lib/map/theme";
import NetworkMap, { type Selection } from "./NetworkMap";
import LineChip from "./map/LineChip";
import TimeBar from "./TimeBar";
import BottomSheet from "./BottomSheet";
import DisruptionCard from "./DisruptionCard";
import StationSheet from "./map/StationSheet";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  running: { label: "Running", cls: "text-ok" },
  "no-service": { label: "No trains at this time", cls: "text-ink-dim" },
  "bus-replacement": { label: "Buses replace trains", cls: "text-bad" },
  warning: { label: "Check before you travel", cls: "text-warn" },
};

export default function MapScreen() {
  const searchParams = useSearchParams();
  const initialAt = searchParams.get("at");
  const initialLine = searchParams.get("line");
  const [at, setAt] = useState<string | null>(initialAt); // datetime-local, null = now
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState(false);
  const [sel, setSel] = useState<Selection | null>(null);
  // ?line= wins; otherwise restore the last focused line from localStorage.
  // useSearchParams() above opts this route's prerender out of MapScreen, so
  // production never hydrates this markup; the typeof window guard below covers
  // dev's dynamic SSR.
  const [focusedLine, setFocusedLine] = useState<LineId | null>(() => {
    if (initialLine) return LINE_BY_ID.has(initialLine as LineId) ? (initialLine as LineId) : null;
    if (typeof window === "undefined") return null;
    const saved = localStorage.getItem("imtr:line");
    return saved && LINE_BY_ID.has(saved as LineId) ? (saved as LineId) : null;
  });

  // With at === null the theme follows the instant the displayed status was
  // computed for (status.at), so each five-minute refresh rolls it over —
  // no second timer, and theme and map can never disagree about the time
  // being shown. A bare new Date() memoized on [at] would freeze at mount.
  const theme = useMemo(
    () => mapThemeFor(at ? new Date(at) : status ? new Date(status.at) : new Date()),
    [at, status]
  );

  useEffect(() => {
    if (focusedLine) localStorage.setItem("imtr:line", focusedLine);
    else localStorage.removeItem("imtr:line");
  }, [focusedLine]);

  const load = useCallback(async () => {
    try {
      const q = at ? `?at=${encodeURIComponent(new Date(at).toISOString())}` : "";
      const res = await fetch(`/api/status${q}`);
      if (!res.ok) throw new Error();
      setStatus(await res.json());
      setError(false);
    } catch {
      setError(true);
    }
  }, [at]);

  useEffect(() => {
    load();
    if (at !== null) return;
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [load, at]);

  const selDisruptions =
    sel && status ? status.disruptions.filter((d) => sel.status.disruptionIds.includes(d.id)) : [];
  const selLine = sel?.kind === "edge" ? LINE_BY_ID.get(sel.edge.lineId) : null;

  return (
    <div className="flex h-full flex-col">
      <TimeBar at={at} onChange={setAt} updatedAt={status?.dataUpdatedAt} stale={status?.stale} />

      <div className="relative min-h-0 flex-1">
        <NetworkMap status={status} focusedLine={focusedLine} theme={theme} onSelect={setSel} />

        <div className="pointer-events-none absolute left-3 top-3">
          <LineChip value={focusedLine} onChange={setFocusedLine} />
        </div>

        {!status && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="tabular animate-pulse rounded-full bg-elevated/90 px-4 py-2 text-sm text-ink-dim">
              Loading network…
            </p>
          </div>
        )}
        {error && (
          <div className="absolute inset-x-4 top-4 mx-auto max-w-md">
            <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
              Couldn&apos;t load status.{" "}
              <button onClick={load} className="font-bold underline cursor-pointer">
                Retry
              </button>
            </p>
          </div>
        )}

        {/* Legend. Running lines keep each line's own colour (never a generic
            "ok" green) and no-service is a deliberately unalarming dimmed dot,
            so neither earns a legend swatch here — only the three states that
            actually need decoding do. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <div className="flex items-center gap-3 rounded-full border border-hairline bg-elevated/90 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-dim backdrop-blur">
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-4 rounded-full bg-ink-dim [background-image:repeating-linear-gradient(90deg,transparent,transparent_3px,var(--bg-elevated)_3px,var(--bg-elevated)_5px)]" />{" "}
              Buses
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-warn ring-1 ring-hairline" /> Terminates
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-bad" /> Closed
            </span>
          </div>
        </div>

        {/* Line warnings ribbon */}
        {status && status.lineWarnings.length > 0 && (
          <div className="absolute inset-x-4 top-3 mx-auto max-w-md">
            <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              ⚠{" "}
              {status.lineWarnings
                .map((w) => LINE_BY_ID.get(w.lineId)?.name)
                .filter(Boolean)
                .join(", ")}{" "}
              — disruption details couldn&apos;t be fully read. Check before you travel.
            </p>
          </div>
        )}
      </div>

      <BottomSheet open={!!sel} onClose={() => setSel(null)}>
        {sel?.kind === "station" && (
          <StationSheet
            stationId={sel.stationId}
            status={sel.status}
            disruptions={selDisruptions}
            focusedLine={focusedLine}
          />
        )}
        {sel?.kind === "edge" && selLine && (
          <div>
            <div className="flex items-center gap-2.5">
              <span className="h-3 w-3 rounded-full" style={{ background: selLine.color }} aria-hidden />
              <h2 className="text-base font-extrabold">{selLine.name} line</h2>
            </div>
            <p className="mt-1 text-sm text-ink-dim">
              {STATIONS.get(sel.edge.from)?.name} → {STATIONS.get(sel.edge.to)?.name}
            </p>
            <p className={`mt-3 text-sm font-bold ${STATUS_LABEL[sel.status.status].cls}`}>
              {STATUS_LABEL[sel.status.status].label}
            </p>
            {selDisruptions.map((d) => (
              <DisruptionCard key={d.id} d={d} />
            ))}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
