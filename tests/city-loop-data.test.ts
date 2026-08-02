import { describe, it, expect } from "vitest";
import { LINES, LOOP } from "@/lib/network/data";

const LOOP_ONLY = ["flagstaff", "melbourne-central", "parliament"];

describe("LOOP data", () => {
  it("rings the five city stations", () => {
    expect(LOOP.ring).toEqual([
      "flinders-street",
      "southern-cross",
      "flagstaff",
      "melbourne-central",
      "parliament",
    ]);
  });

  it("covers the nine loop-served lines exactly once each", () => {
    const served = LOOP.groups.flatMap((g) => g.lines);
    expect(served).toHaveLength(9);
    expect(new Set(served).size).toBe(9);
    expect([...served].sort()).toEqual(
      [
        "alamein",
        "belgrave",
        "craigieburn",
        "frankston",
        "glen-waverley",
        "hurstbridge",
        "lilydale",
        "mernda",
        "upfield",
      ].sort()
    );
  });

  it("only names lines and stations that exist", () => {
    for (const g of LOOP.groups) {
      for (const id of g.lines) {
        expect(LINES.find((l) => l.id === id), `unknown line ${id}`).toBeDefined();
      }
      for (const s of [...g.order, g.portal]) {
        expect(LOOP.ring.includes(s) || LINES.some((l) => l.stations.includes(s)), `unknown station ${s}`).toBe(true);
      }
    }
  });

  it("orders only ring stations, never repeating one, never including Flinders Street", () => {
    for (const g of LOOP.groups) {
      expect(new Set(g.order).size, `${g.color} repeats a station`).toBe(g.order.length);
      expect(g.order).not.toContain("flinders-street");
      for (const s of g.order) expect(LOOP.ring).toContain(s);
    }
  });

  it("gives every group all three loop-only stations", () => {
    // Flagstaff, Melbourne Central and Parliament are on the ring itself, so a
    // group that skips one would leave that station unserved by that colour.
    for (const g of LOOP.groups) {
      for (const s of LOOP_ONLY) expect(g.order, `${g.color} misses ${s}`).toContain(s);
    }
  });

  it("attaches each group to a portal on its own lines' trunks", () => {
    for (const g of LOOP.groups) {
      for (const id of g.lines) {
        const line = LINES.find((l) => l.id === id)!;
        expect(line.stations, `${id} does not stop at portal ${g.portal}`).toContain(g.portal);
      }
    }
  });

  it("does not put loop-only stations into any line array", () => {
    // The whole point of the overlay: the 16 arrays stay untouched.
    for (const line of LINES) {
      for (const s of LOOP_ONLY) expect(line.stations, `${line.id} was modified`).not.toContain(s);
    }
  });
});
