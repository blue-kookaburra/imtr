import { describe, it, expect } from "vitest";
import { EDGES } from "@/lib/network/build";
import { EDGE_PATH, pathD } from "@/lib/map/geometry";
import { hitOrder } from "@/lib/map/hit";
import type { Edge } from "@/lib/types";

// Edges that are drawn along the identical polyline: a tap anywhere on it hits
// every one of them, and only draw order decides which the click handler gets.
const stacks = (() => {
  const byPath = new Map<string, Edge[]>();
  for (const e of EDGES) {
    const pts = EDGE_PATH[e.id];
    if (!pts) continue;
    const d = pathD(pts);
    const group = byPath.get(d);
    if (group) group.push(e);
    else byPath.set(d, [e]);
  }
  return [...byPath.values()].filter((g) => g.length > 1);
})();

describe("stacked edge tap targets", () => {
  it("has stacked polylines to disambiguate at all", () => {
    // If this ever drops to zero the geometry stopped sharing polylines and
    // the rest of this file is vacuous rather than passing.
    expect(stacks.length).toBeGreaterThan(10);
    expect(Math.max(...stacks.map((g) => g.length))).toBeGreaterThanOrEqual(4);
  });

  it("gives the focused line the tap on every polyline it shares", () => {
    for (const stack of stacks) {
      for (const focus of new Set(stack.map((e) => e.lineId))) {
        const ordered = hitOrder(EDGES, focus);
        const last = ordered.filter((e) => stack.includes(e)).pop()!;
        expect(last.lineId, `${stack.map((e) => e.id).join(" / ")} focused on ${focus}`).toBe(focus);
      }
    }
  });

  it("leaves the order alone when no line is focused", () => {
    // Nothing has been said about which line the user means, so inventing a
    // winner here would just be a different arbitrary one.
    expect(hitOrder(EDGES, null)).toBe(EDGES);
  });

  it("keeps every edge exactly once", () => {
    const ordered = hitOrder(EDGES, "belgrave");
    expect(ordered.length).toBe(EDGES.length);
    expect(new Set(ordered.map((e) => e.id)).size).toBe(EDGES.length);
  });
});
