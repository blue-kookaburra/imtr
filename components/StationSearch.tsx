"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { stationList } from "@/lib/network/build";
import type { Station } from "@/lib/types";

interface Props {
  value: string | null; // station id
  onChange: (id: string) => void;
}

const RECENTS_KEY = "imtr-recent-stations";

function getRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export default function StationSearch({ value, onChange }: Props) {
  const stations = useMemo(
    () => stationList().sort((a, b) => a.name.localeCompare(b.name)),
    []
  );
  const byId = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setRecents(getRecents()), []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return stations.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, stations]);

  function pick(s: Station) {
    onChange(s.id);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
    const next = [s.id, ...getRecents().filter((r) => r !== s.id)].slice(0, 5);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    setRecents(next);
  }

  const selected = value ? byId.get(value) : null;

  return (
    <div className="relative">
      <label htmlFor="station-search" className="sr-only">
        Search for a station
      </label>
      <input
        ref={inputRef}
        id="station-search"
        type="search"
        autoComplete="off"
        placeholder={selected ? selected.name : "Search station…"}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-full rounded-xl border border-hairline bg-bg px-4 py-3 text-base font-semibold placeholder:font-normal placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />
      {open && (matches.length > 0 || (query === "" && recents.length > 0)) && (
        <ul className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-hairline bg-sheet shadow-2xl">
          {query === "" && recents.length > 0 && (
            <li className="px-4 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-ink-faint">
              Recent
            </li>
          )}
          {(query === "" ? recents.map((id) => byId.get(id)).filter((s): s is Station => !!s) : matches).map(
            (s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => pick(s)}
                  className="w-full px-4 py-3 text-left text-sm font-semibold transition-colors duration-100 hover:bg-bg cursor-pointer"
                >
                  {s.name}
                </button>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}
