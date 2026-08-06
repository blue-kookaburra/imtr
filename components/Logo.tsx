import { MARK_PATHS, MARK_VIEW_BOX } from "./brand/mark";

// The running-train mark, inlined rather than loaded as an <img> so it paints
// with the first frame of the header — no second request, no swap, and it
// takes its colour from whatever `text-*` is in scope.
//
// Decorative: every place this appears sits beside the app name in text, so
// announcing it again would only repeat that name to a screen reader.
export default function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox={MARK_VIEW_BOX} className={className} fill="currentColor" aria-hidden focusable="false">
      {MARK_PATHS.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
