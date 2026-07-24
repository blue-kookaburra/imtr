"use client";

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
  return (
    <header className="shrink-0 border-b border-hairline bg-elevated/95 px-4 pt-[calc(env(safe-area-inset-top)+10px)] pb-2.5 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center gap-3">
        <h1 className="flex-1 text-[15px] font-extrabold leading-tight tracking-tight">
          Is my train running?
        </h1>
        <div className="flex items-center rounded-full border border-hairline bg-bg p-0.5">
          <button
            type="button"
            onClick={() => onChange(null)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors duration-150 cursor-pointer ${
              showingNow ? "bg-accent text-black" : "text-ink-dim"
            }`}
          >
            Now
          </button>
          <label
            className={`relative rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors duration-150 cursor-pointer ${
              showingNow ? "text-ink-dim" : "bg-accent text-black"
            }`}
          >
            Later
            <input
              type="datetime-local"
              aria-label="Show status at a future date and time"
              min={nowLocalValue()}
              value={at ?? ""}
              onChange={(e) => onChange(e.target.value || null)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
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
