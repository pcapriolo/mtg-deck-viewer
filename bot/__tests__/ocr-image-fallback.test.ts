/**
 * Tests for extractDecklistFromImages multi-image fallback logic.
 *
 * We test the core selection algorithm (selectBestOcrResult) directly —
 * it is pure logic with no I/O, so no mocking is needed.
 * We also verify MIN_MAINBOARD_CARDS threshold is 10.
 */
import { describe, it, expect } from "vitest";
import { selectBestOcrResult, MIN_MAINBOARD_CARDS } from "../ocr";
import type { OcrResult } from "../ocr";

// Minimal OcrResult factory — mainCount cards in mainboard, no sideboard
function makeResult(mainCount: number): OcrResult {
  const lines = Array.from({ length: mainCount }, (_, i) => `1 Card ${i + 1}`);
  return {
    decklist: lines.join("\n"),
    expectedCount: null,
    actualCount: mainCount,
    correctionRan: false,
    correctionAccepted: false,
    passCount: 1,
    imageUrl: "https://example.com/img.jpg",
  };
}

describe("MIN_MAINBOARD_CARDS", () => {
  it("is 10", () => {
    expect(MIN_MAINBOARD_CARDS).toBe(10);
  });
});

describe("selectBestOcrResult", () => {
  it("returns the first result with >= 10 mainboard cards", () => {
    const poor = makeResult(4);   // card art — too few
    const good = makeResult(60);  // actual decklist
    expect(selectBestOcrResult([poor, good])).toBe(good);
  });

  it("returns immediately on the first result that meets the threshold", () => {
    const good  = makeResult(60);
    const other = makeResult(55);
    // good meets threshold — other should not even be considered
    expect(selectBestOcrResult([good, other])).toBe(good);
  });

  it("returns the highest-count result when none meet the threshold", () => {
    const result3 = makeResult(3);
    const result7 = makeResult(7);
    expect(selectBestOcrResult([result3, result7])).toBe(result7);
  });

  it("returns the first result that exactly meets the threshold (= 10)", () => {
    const borderline = makeResult(10);
    const better     = makeResult(60);
    // borderline meets threshold — should be returned without checking better
    expect(selectBestOcrResult([borderline, better])).toBe(borderline);
  });

  it("returns null for an empty list", () => {
    expect(selectBestOcrResult([])).toBeNull();
  });

  it("returns null when all entries are null", () => {
    expect(selectBestOcrResult([null, null])).toBeNull();
  });

  it("skips null entries and finds the good result", () => {
    const good = makeResult(60);
    expect(selectBestOcrResult([null, good])).toBe(good);
  });

  it("handles list of a single result below threshold — returns that result as best", () => {
    const onlyResult = makeResult(5);
    expect(selectBestOcrResult([onlyResult])).toBe(onlyResult);
  });

  it("handles result with exactly 9 cards — just below threshold", () => {
    const almostGood = makeResult(9);
    const good       = makeResult(60);
    expect(selectBestOcrResult([almostGood, good])).toBe(good);
  });
});
