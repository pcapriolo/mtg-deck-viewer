import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isFrozenUptime, resolveRailwayBin } from "../review-cron";

describe("isFrozenUptime", () => {
  it("returns true when both uptimes are identical (frozen process)", () => {
    expect(isFrozenUptime(38108.363038576, 38108.363038576)).toBe(true);
  });

  it("returns true when uptimes differ by less than 0.1s (float noise)", () => {
    expect(isFrozenUptime(1000.001, 1000.05)).toBe(true);
  });

  it("returns false when uptimes differ by 5s (healthy process)", () => {
    expect(isFrozenUptime(38108.363, 38113.363)).toBe(false);
  });

  it("returns false when uptimes differ by exactly 0.1s (boundary)", () => {
    // Difference of exactly 0.1 should NOT be considered frozen
    expect(isFrozenUptime(1000.0, 1000.1)).toBe(false);
  });

  it("returns false when uptime advances by 1s (healthy)", () => {
    expect(isFrozenUptime(5000.0, 5001.0)).toBe(false);
  });
});

describe("resolveRailwayBin", () => {
  it("returns a non-empty string", () => {
    const result = resolveRailwayBin();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns a path ending with 'railway'", () => {
    const result = resolveRailwayBin();
    expect(result).toMatch(/railway$/);
  });
});
