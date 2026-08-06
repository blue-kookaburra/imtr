import type { Edge, LineId } from "@/lib/types";

// Which edge wins a tap where several lines share one polyline.
//
// The map draws one invisible fat hit path per edge, so on a shared polyline
// the last one drawn is the one the tap lands on. 66 polylines are shared; the
// deepest is parliament-richmond with 5 lines, where Frankston comes last in
// EDGES and always won — tapping the Belgrave-coloured ring lane with Belgrave
// focused opened a Frankston sheet.
//
// Focusing a line is the user saying which line they mean, so its edges are
// drawn last and win. With nothing focused there is no such signal and the
// order is left alone.
export function hitOrder(edges: readonly Edge[], focusedLine: LineId | null): readonly Edge[] {
  if (focusedLine === null) return edges;
  return [...edges].sort(
    (a, b) => Number(a.lineId === focusedLine) - Number(b.lineId === focusedLine)
  );
}
