import { describe, it, expect } from "vitest";
import { mapThemeFor } from "@/lib/map/theme";

// All instants below are expressed in UTC; Melbourne is UTC+10 in August (AEST).
describe("map theme", () => {
  it("is day through the middle of the day", () => {
    expect(mapThemeFor(new Date("2026-08-05T02:00:00Z"))).toBe("day"); // 12:00 Melbourne
    expect(mapThemeFor(new Date("2026-08-04T22:00:00Z"))).toBe("day"); // 08:00 Melbourne
  });

  it("is dusk in the early evening and early morning", () => {
    expect(mapThemeFor(new Date("2026-08-05T08:30:00Z"))).toBe("dusk"); // 18:30 Melbourne
    expect(mapThemeFor(new Date("2026-08-04T20:00:00Z"))).toBe("dusk"); // 06:00 Melbourne
  });

  it("is night late and very early", () => {
    expect(mapThemeFor(new Date("2026-08-05T12:00:00Z"))).toBe("night"); // 22:00 Melbourne
    expect(mapThemeFor(new Date("2026-08-04T17:00:00Z"))).toBe("night"); // 03:00 Melbourne
  });

  it("follows Melbourne time, not the viewer's timezone", () => {
    // 02:00 UTC is midday in Melbourne regardless of where the browser is.
    expect(mapThemeFor(new Date("2026-01-15T02:00:00Z"))).toBe("day"); // 13:00 AEDT
  });
});
