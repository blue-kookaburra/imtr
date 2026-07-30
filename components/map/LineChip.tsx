"use client";

import { LINE_DEFS } from "@/lib/network/build";
import type { LineId } from "@/lib/types";

interface Props {
  value: LineId | null;
  onChange: (id: LineId | null) => void;
}

export default function LineChip({ value, onChange }: Props) {
  const selected = LINE_DEFS.find((l) => l.id === value);
  return (
    <label className="pointer-events-auto flex items-center gap-2 rounded-full border border-hairline bg-elevated/95 py-1.5 pl-3 pr-2 text-xs font-bold backdrop-blur">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: selected?.color ?? "var(--ink-faint)" }}
        aria-hidden
      />
      <span className="sr-only">Focus a line</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || null) as LineId | null)}
        className="cursor-pointer appearance-none bg-transparent pr-4 uppercase tracking-wider outline-none"
      >
        <option value="">All lines</option>
        {LINE_DEFS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
