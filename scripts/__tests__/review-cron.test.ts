import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isFrozenUptime, resolveRailwayBin, detectIssues, type Interaction } from "../review-cron";

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

// ---------------------------------------------------------------------------
// detectIssues
// ---------------------------------------------------------------------------

function makeInteraction(overrides: Partial<Interaction>): Interaction {
  return {
    tweetId: "tweet-1",
    ocrSuccess: true,
    ocrCardsExtracted: 60,
    mainboardCount: 60,
    totalTimeMs: 5000,
    ...overrides,
  };
}

describe("detectIssues", () => {
  it("returns no issues for a healthy interaction", () => {
    const issues = detectIssues([makeInteraction({})]);
    expect(issues).toHaveLength(0);
  });

  it("flags count_mismatch when extracted cards < 90% of expected", () => {
    const issues = detectIssues([
      makeInteraction({ ocrExpectedCount: 100, ocrCardsExtracted: 85 }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("count_mismatch");
    expect(issues[0].severity).toBe("critical");
    expect(issues[0].expectedCount).toBe(100);
    expect(issues[0].actualCount).toBe(85);
  });

  it("skips count_mismatch when ocrExpectedCount is null", () => {
    const issues = detectIssues([
      makeInteraction({ ocrExpectedCount: null, ocrCardsExtracted: 5, mainboardCount: 60 }),
    ]);
    // count_mismatch skipped — should not fire; interaction is otherwise healthy
    expect(issues.every((i) => i.type !== "count_mismatch")).toBe(true);
  });

  it("flags low_extraction when mainboardCount < 40 and ocrSuccess is true", () => {
    const issues = detectIssues([
      makeInteraction({ mainboardCount: 30, ocrSuccess: true }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("low_extraction");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].actualCount).toBe(30);
  });

  it("flags ocr_failure when ocrSuccess is false", () => {
    const issues = detectIssues([
      makeInteraction({ ocrSuccess: false, mainboardCount: 0, ocrCardsExtracted: 0 }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("ocr_failure");
    expect(issues[0].severity).toBe("critical");
  });

  it("flags scryfall_miss when scryfallCardsNotFound has more than 3 entries", () => {
    const issues = detectIssues([
      makeInteraction({ scryfallCardsNotFound: ["A", "B", "C", "D"] }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("scryfall_miss");
    expect(issues[0].severity).toBe("warning");
  });

  it("does not flag scryfall_miss when scryfallCardsNotFound has 3 or fewer entries", () => {
    const issues = detectIssues([
      makeInteraction({ scryfallCardsNotFound: ["A", "B", "C"] }),
    ]);
    expect(issues.every((i) => i.type !== "scryfall_miss")).toBe(true);
  });

  it("flags high_latency when totalTimeMs exceeds 30000", () => {
    const issues = detectIssues([
      makeInteraction({ totalTimeMs: 35000 }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("high_latency");
    expect(issues[0].severity).toBe("warning");
  });

  it("count_mismatch takes priority — same interaction skips low_extraction check", () => {
    // An interaction with both count_mismatch AND low mainboardCount should
    // only produce count_mismatch (the continue statement prevents double-flagging)
    const issues = detectIssues([
      makeInteraction({ ocrExpectedCount: 100, ocrCardsExtracted: 20, mainboardCount: 20 }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("count_mismatch");
  });
});
