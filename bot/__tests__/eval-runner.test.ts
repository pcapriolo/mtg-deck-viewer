import { describe, it, expect } from "vitest";
import {
  parseDeckMap,
  diffDecklists,
  checkRegression,
  type EvalResult,
  type Baseline,
} from "../eval-runner";

// ---------------------------------------------------------------------------
// parseDeckMap
// ---------------------------------------------------------------------------

describe("parseDeckMap", () => {
  it("parses standard 'N CardName' lines", () => {
    const map = parseDeckMap("4 Lightning Bolt\n2 Counterspell");
    expect(map.get("lightning bolt")).toBe(4);
    expect(map.get("counterspell")).toBe(2);
  });

  it("lowercases card names for case-insensitive matching", () => {
    const map = parseDeckMap("4 Lightning Bolt");
    expect(map.has("lightning bolt")).toBe(true);
    expect(map.has("Lightning Bolt")).toBe(false);
  });

  it("sums duplicate card entries", () => {
    const map = parseDeckMap("2 Lightning Bolt\n2 Lightning Bolt");
    expect(map.get("lightning bolt")).toBe(4);
  });

  it("ignores lines without a leading quantity", () => {
    const map = parseDeckMap("Sideboard\n2 Pyroblast\nName: Burn");
    expect(map.get("pyroblast")).toBe(2);
    expect(map.size).toBe(1);
  });

  it("returns empty map for empty string", () => {
    expect(parseDeckMap("").size).toBe(0);
  });

  it("handles blank lines gracefully", () => {
    const map = parseDeckMap("4 Lightning Bolt\n\n2 Counterspell\n");
    expect(map.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// diffDecklists
// ---------------------------------------------------------------------------

describe("diffDecklists", () => {
  it("returns perfect accuracy for identical decklists", () => {
    const deck = "4 Lightning Bolt\n2 Counterspell";
    const result = diffDecklists(deck, deck);
    expect(result.cardNameAccuracy).toBe(1);
    expect(result.quantityAccuracy).toBe(1);
    expect(result.countMatch).toBe(true);
  });

  it("returns zero accuracy when output is empty", () => {
    const result = diffDecklists("4 Lightning Bolt", "");
    expect(result.cardNameAccuracy).toBe(0);
    expect(result.quantityAccuracy).toBe(0);
    expect(result.countMatch).toBe(false);
  });

  it("detects missing card names (OCR missed a card)", () => {
    const groundTruth = "4 Lightning Bolt\n2 Counterspell";
    const output = "4 Lightning Bolt";
    const result = diffDecklists(groundTruth, output);
    // 1 of 2 names found
    expect(result.cardNameAccuracy).toBeCloseTo(0.5);
  });

  it("detects wrong quantities (OCR misread count)", () => {
    const groundTruth = "4 Lightning Bolt\n2 Counterspell";
    const output = "3 Lightning Bolt\n2 Counterspell";
    const result = diffDecklists(groundTruth, output);
    // Both names found
    expect(result.cardNameAccuracy).toBe(1);
    // Only 1 of 2 quantities correct
    expect(result.quantityAccuracy).toBeCloseTo(0.5);
  });

  it("countMatch is true only when total card counts match", () => {
    const groundTruth = "4 Lightning Bolt\n2 Counterspell"; // 6 total
    const output = "4 Lightning Bolt\n3 Counterspell"; // 7 total
    const result = diffDecklists(groundTruth, output);
    expect(result.countMatch).toBe(false);
  });

  it("returns zeros when groundTruth is empty", () => {
    const result = diffDecklists("", "4 Lightning Bolt");
    expect(result.cardNameAccuracy).toBe(0);
    expect(result.quantityAccuracy).toBe(0);
    expect(result.countMatch).toBe(false);
  });

  it("is case-insensitive for card names", () => {
    const groundTruth = "4 Lightning Bolt";
    const output = "4 LIGHTNING BOLT";
    const result = diffDecklists(groundTruth, output);
    expect(result.cardNameAccuracy).toBe(1);
    expect(result.quantityAccuracy).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// checkRegression
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    caseId: "case-001",
    inputType: "text",
    verified: true,
    groundTruthCount: 60,
    outputCount: 60,
    cardNameAccuracy: 1.0,
    quantityAccuracy: 1.0,
    countMatch: true,
    scryfallResolved: 1.0,
    errors: [],
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    updatedAt: "2026-03-01T00:00:00Z",
    caseCount: 1,
    aggregateCardNameAccuracy: 0.9,
    aggregateQuantityAccuracy: 0.9,
    aggregateCountMatch: 1,
    aggregateScryfallResolved: 0.9,
    cases: {
      "case-001": { cardNameAccuracy: 0.9, quantityAccuracy: 0.9 },
    },
    ...overrides,
  };
}

describe("checkRegression", () => {
  it("returns empty array when results improve on baseline", () => {
    const results = [makeResult({ cardNameAccuracy: 1.0, quantityAccuracy: 1.0, scryfallResolved: 1.0 })];
    const baseline = makeBaseline();
    expect(checkRegression(results, baseline)).toEqual([]);
  });

  it("returns empty array when all results have errors (nothing to compare)", () => {
    const results = [makeResult({ errors: ["OCR failed"] })];
    expect(checkRegression(results, makeBaseline())).toEqual([]);
  });

  it("detects aggregate card name accuracy regression", () => {
    const results = [makeResult({ cardNameAccuracy: 0.5, scryfallResolved: 1.0 })];
    const baseline = makeBaseline({ aggregateCardNameAccuracy: 0.9 });
    const regressions = checkRegression(results, baseline);
    expect(regressions.some((r) => r.toLowerCase().includes("card name accuracy"))).toBe(true);
  });

  it("detects aggregate quantity accuracy regression", () => {
    const results = [makeResult({ quantityAccuracy: 0.5, scryfallResolved: 1.0 })];
    const baseline = makeBaseline({ aggregateQuantityAccuracy: 0.9 });
    const regressions = checkRegression(results, baseline);
    expect(regressions.some((r) => r.toLowerCase().includes("quantity accuracy"))).toBe(true);
  });

  it("detects aggregate Scryfall resolution regression", () => {
    const results = [makeResult({ scryfallResolved: 0.5 })];
    const baseline = makeBaseline({ aggregateScryfallResolved: 0.9 });
    const regressions = checkRegression(results, baseline);
    expect(regressions.some((r) => r.toLowerCase().includes("scryfall"))).toBe(true);
  });

  it("detects per-case card name accuracy regression", () => {
    const results = [makeResult({ caseId: "case-001", cardNameAccuracy: 0.5 })];
    const baseline = makeBaseline({
      aggregateCardNameAccuracy: 0.5,
      cases: { "case-001": { cardNameAccuracy: 0.9, quantityAccuracy: 0.9 } },
    });
    const regressions = checkRegression(results, baseline);
    expect(regressions.some((r) => r.includes("case-001"))).toBe(true);
  });

  it("allows small floating point variance within tolerance (0.01)", () => {
    // Accuracy dropped by exactly 0.005 — within tolerance
    const results = [makeResult({ cardNameAccuracy: 0.895, scryfallResolved: 1.0 })];
    const baseline = makeBaseline({ aggregateCardNameAccuracy: 0.9 });
    expect(checkRegression(results, baseline)).toEqual([]);
  });

  it("skips cases that did not exist in baseline (new cases never regress)", () => {
    const results = [makeResult({ caseId: "new-case", cardNameAccuracy: 0.0, scryfallResolved: 0.0 })];
    const baseline = makeBaseline({ cases: {} });
    // Aggregate may regress, but per-case check for "new-case" should produce no entry
    const regressions = checkRegression(results, baseline);
    const perCaseRegressions = regressions.filter((r) => r.includes("new-case"));
    expect(perCaseRegressions).toEqual([]);
  });
});
