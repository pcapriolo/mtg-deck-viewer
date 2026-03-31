import { describe, it, expect } from "vitest";
import { avg, bucketAccuracy } from "../eval-images-only";

// ---------------------------------------------------------------------------
// avg
// ---------------------------------------------------------------------------

describe("avg", () => {
  it("returns the arithmetic mean of a non-empty array", () => {
    expect(avg([1, 2, 3])).toBeCloseTo(2);
  });

  it("returns 0 for an empty array", () => {
    expect(avg([])).toBe(0);
  });

  it("handles a single-element array", () => {
    expect(avg([0.75])).toBe(0.75);
  });

  it("averages accuracy values in [0, 1] range", () => {
    expect(avg([1.0, 0.8, 0.6])).toBeCloseTo(0.8);
  });
});

// ---------------------------------------------------------------------------
// bucketAccuracy
// ---------------------------------------------------------------------------

describe("bucketAccuracy", () => {
  it("assigns >= 0.95 to perfect bucket", () => {
    const result = bucketAccuracy([{ cardNameAccuracy: 0.95 }, { cardNameAccuracy: 1.0 }]);
    expect(result.perfect).toBe(2);
    expect(result.good).toBe(0);
  });

  it("assigns 0.80–0.94 to good bucket", () => {
    const result = bucketAccuracy([{ cardNameAccuracy: 0.80 }, { cardNameAccuracy: 0.90 }]);
    expect(result.good).toBe(2);
    expect(result.perfect).toBe(0);
  });

  it("assigns 0.60–0.79 to fair bucket", () => {
    const result = bucketAccuracy([{ cardNameAccuracy: 0.60 }, { cardNameAccuracy: 0.70 }]);
    expect(result.fair).toBe(2);
  });

  it("assigns 0.30–0.59 to poor bucket", () => {
    const result = bucketAccuracy([{ cardNameAccuracy: 0.30 }, { cardNameAccuracy: 0.50 }]);
    expect(result.poor).toBe(2);
  });

  it("assigns < 0.30 to bad bucket", () => {
    const result = bucketAccuracy([{ cardNameAccuracy: 0.0 }, { cardNameAccuracy: 0.29 }]);
    expect(result.bad).toBe(2);
  });

  it("returns all zeros for empty input", () => {
    const result = bucketAccuracy([]);
    expect(result).toEqual({ perfect: 0, good: 0, fair: 0, poor: 0, bad: 0 });
  });

  it("distributes mixed results across all buckets", () => {
    const result = bucketAccuracy([
      { cardNameAccuracy: 1.0 },   // perfect
      { cardNameAccuracy: 0.85 },  // good
      { cardNameAccuracy: 0.65 },  // fair
      { cardNameAccuracy: 0.45 },  // poor
      { cardNameAccuracy: 0.10 },  // bad
    ]);
    expect(result).toEqual({ perfect: 1, good: 1, fair: 1, poor: 1, bad: 1 });
  });

  it("treats exact boundary values as the upper bucket", () => {
    // 0.95 is perfect (>= 0.95), 0.80 is good (>= 0.80), etc.
    const result = bucketAccuracy([
      { cardNameAccuracy: 0.95 },
      { cardNameAccuracy: 0.80 },
      { cardNameAccuracy: 0.60 },
      { cardNameAccuracy: 0.30 },
    ]);
    expect(result.perfect).toBe(1);
    expect(result.good).toBe(1);
    expect(result.fair).toBe(1);
    expect(result.poor).toBe(1);
    expect(result.bad).toBe(0);
  });
});
