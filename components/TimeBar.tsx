"use client";

import { useRef } from "react";
import Logo from "./Logo";

interface Props {
  at: string | null; // datetime-local value, null = now
  onChange: (at: string | null) => void;
  updatedAt?: string;
  stale?: boolean;
}

function nowLocalValue(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function TimeBar({ at, onChange, updatedAt, stale }: Props) {
  const showingNow = at === null;
  const pickerRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const el = pickerRef.current;
    if (!el) return;
    // showPicker needs a user gesture; fall back to focus for old browsers.
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  }
  return (
    <header className="shrink-0 border-b border-hairline bg-elevated/95 px-4 pt-[calc(env(safe-area-inset-top)+10px)] pb-2.5 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center gap-2.5">
        {/* h-8 is the floor the mark stays legible at — its window and grille
            lines grey out below roughly 32px. The Now/Later pills are taller
            than this, so the mark costs no header height. */}
        <Logo className="h-8 w-auto shrink-0 text-ink" />
        <h1 className="flex-1 text-[15px] font-extrabold leading-tight tracking-tight">
          Is my train running?
        </h1>
        <div className="flex items-center rounded-full border border-hairline bg-bg p-0.5">
          <button
            type="button"
            onClick={() => onChange(null)}
            className={`rounded-full px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors duration-150 cursor-pointer ${
              showingNow ? "bg-accent text-white" : "text-ink-dim"
            }`}
          >
            Now
          </button>
          <button
            type="button"
            onClick={openPicker}
            className={`relative rounded-full px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors duration-150 cursor-pointer ${
              showingNow ? "text-ink-dim" : "bg-accent text-white"
            }`}
          >
            Later
            <input
              ref={pickerRef}
              type="datetime-local"
              aria-label="Show status at a future date and time"
              min={nowLocalValue()}
              value={at ?? ""}
              onChange={(e) => onChange(e.target.value || null)}
              tabIndex={-1}
              className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
            />
          </button>
        </div>
      </div>
      {!showingNow && at && (
        <div className="mx-auto mt-2 flex max-w-md items-center gap-2">
          <span className="tabular rounded-md bg-sheet px-2.5 py-1 text-xs text-accent">
            Showing{" "}
            {new Date(at).toLocaleString("en-AU", {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs font-semibold text-ink-dim underline underline-offset-2 cursor-pointer"
          >
            Back to now
          </button>
        </div>
      )}
      {stale && updatedAt && (
        <div className="mx-auto mt-2 max-w-md">
          <p className="rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1 text-xs text-warn">
            Data last updated{" "}
            {new Date(updatedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })} —
            may be out of date.
          </p>
        </div>
      )}
    </header>
  );
}
