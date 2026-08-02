import { describe, it, expect } from "vitest";
import { EDGES, STATIONS } from "@/lib/network/build";

describe("City Loop build", () => {
  it("creates the three loop-only stations", () => {
    for (const id of ["flagstaff", "melbourne-central", "parliament"]) {
      expect(STATIONS.get(id), `${id} missing`).toBeDefined();
    }
  });

  it("serves all nine loop lines at every loop-only station", () => {
    for (const id of ["flagstaff", "melbourne-central", "parliament"]) {
      expect(STATIONS.get(id)!.lines.sort()).toEqual(
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
    }
  });

  it("marks loop stations as interchanges", () => {
    // Four colour groups meet on the ring, so the existing interchange rule
    // (more than one colour) must already be firing for them.
    for (const id of ["flagstaff", "melbourne-central", "parliament"]) {
      expect(STATIONS.get(id)!.interchange, `${id}`).toBe(true);
    }
  });

  it("gives Southern Cross its loop colours too", () => {
    // Burnley, Clifton Hill and Caulfield loop trains call at Southern Cross
    // even though it is absent from those lines' trunk arrays.
    const sx = STATIONS.get("southern-cross")!;
    for (const id of ["belgrave", "mernda", "frankston"]) {
      expect(sx.lines, `southern-cross missing ${id}`).toContain(id);
    }
  });

  it("chains each group's loop edges from Flinders Street to its portal", () => {
    const ids = new Set(EDGES.map((e) => e.id));
    // Burnley: flinders-street -> southern-cross -> flagstaff ->
    //          melbourne-central -> parliament -> richmond
    for (const id of [
      "belgrave:flinders-street-southern-cross",
      "belgrave:southern-cross-flagstaff",
      "belgrave:flagstaff-melbourne-central",
      "belgrave:melbourne-central-parliament",
      "belgrave:parliament-richmond",
    ]) {
      expect(ids.has(id), `missing ${id}`).toBe(true);
    }
    // Northern runs the other way: flinders-street -> parliament -> ... ->
    // flagstaff -> north-melbourne
    for (const id of [
      "craigieburn:flinders-street-parliament",
      "craigieburn:parliament-melbourne-central",
      "craigieburn:melbourne-central-flagstaff",
      "craigieburn:flagstaff-north-melbourne",
    ]) {
      expect(ids.has(id), `missing ${id}`).toBe(true);
    }
  });

  it("keeps the direct trunk edges the loop runs parallel to", () => {
    const ids = new Set(EDGES.map((e) => e.id));
    // Both paths are real and both are drawn. Losing these would silently
    // delete the direct city approach from the map.
    expect(ids.has("belgrave:flinders-street-richmond")).toBe(true);
    expect(ids.has("craigieburn:flinders-street-southern-cross")).toBe(true);
    expect(ids.has("mernda:flinders-street-jolimont")).toBe(true);
  });

  it("does not duplicate any edge id", () => {
    const ids = EDGES.map((e) => e.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });
});

import { matchSequence, edgesBetween } from "@/lib/network/build";
import { LINES } from "@/lib/network/data";

describe("match sequences", () => {
  it("splices the loop ahead of the trunk for Burnley lines", () => {
    expect(matchSequence("belgrave").slice(0, 8)).toEqual([
      "flinders-street",
      "southern-cross",
      "flagstaff",
      "melbourne-central",
      "parliament",
      "richmond",
      "east-richmond",
      "burnley",
    ]);
  });

  it("splices the loop the other way round for Northern lines", () => {
    expect(matchSequence("craigieburn").slice(0, 6)).toEqual([
      "flinders-street",
      "parliament",
      "melbourne-central",
      "flagstaff",
      "southern-cross",
      "north-melbourne",
    ]);
  });

  it("leaves non-loop lines exactly as their trunk", () => {
    for (const id of ["werribee", "sunbury", "pakenham", "sandringham", "stony-point"] as const) {
      expect(matchSequence(id)).toEqual(LINES.find((l) => l.id === id)!.stations);
    }
  });

  it("never repeats a station in any sequence", () => {
    for (const line of LINES) {
      const seq = matchSequence(line.id);
      const dupes = seq.filter((s, i) => seq.indexOf(s) !== i);
      expect(dupes, `${line.id} repeats`).toEqual([]);
    }
  });

  it("keeps every trunk station, in trunk order", () => {
    // The loop is additive: dropping or reordering a trunk station would
    // silently change which segments an existing disruption covers.
    for (const line of LINES) {
      const seq = matchSequence(line.id);
      const kept = seq.filter((s) => line.stations.includes(s));
      expect(kept, `${line.id}`).toEqual(line.stations);
    }
  });

  it("spans a section through the loop", () => {
    // The real disruption text in data/disruptions.json.
    const ids = edgesBetween("belgrave", "parliament", "box-hill").map((e) => e.id);
    expect(ids).toContain("belgrave:parliament-richmond");
    expect(ids).toContain("belgrave:richmond-east-richmond");
    // Ring stretch beyond Parliament is NOT in a Parliament..Box Hill section.
    expect(ids).not.toContain("belgrave:melbourne-central-parliament");
  });
});
