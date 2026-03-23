import { describe, it, expect } from "vitest";
import {
  parseJsonl,
  filterByTimeWindow,
  computeSummary,
  getDateStringsForWindow,
  InteractionLog,
} from "../metrics-storage";

describe("parseJsonl", () => {
  it("parses valid JSONL lines correctly", () => {
    const content = [
      JSON.stringify({ tweetId: "1", timestamp: "2026-03-23T10:00:00Z" }),
      JSON.stringify({ tweetId: "2", timestamp: "2026-03-23T11:00:00Z" }),
    ].join("\n");

    const results = parseJsonl(content);
    expect(results).toHaveLength(2);
    expect(results[0].tweetId).toBe("1");
    expect(results[1].tweetId).toBe("2");
  });

  it("skips malformed/corrupted JSONL lines without crashing", () => {
    const content = [
      JSON.stringify({ tweetId: "1", timestamp: "2026-03-23T10:00:00Z" }),
      "this is not json {{{",
      "",
      JSON.stringify({ tweetId: "3", timestamp: "2026-03-23T12:00:00Z" }),
      "another bad line",
    ].join("\n");

    const results = parseJsonl(content);
    expect(results).toHaveLength(2);
    expect(results[0].tweetId).toBe("1");
    expect(results[1].tweetId).toBe("3");
  });
});

describe("filterByTimeWindow", () => {
  it("filters entries by time window (hours parameter)", () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);

    const entries: InteractionLog[] = [
      { tweetId: "recent", timestamp: twoHoursAgo.toISOString() },
      { tweetId: "old", timestamp: fiveHoursAgo.toISOString() },
    ];

    const filtered = filterByTimeWindow(entries, 3);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].tweetId).toBe("recent");
  });
});

describe("computeSummary", () => {
  it("returns zeros for empty input", () => {
    const summary = computeSummary([]);
    expect(summary.total).toBe(0);
    expect(summary.successes).toBe(0);
    expect(summary.failures).toBe(0);
    expect(summary.avgTotalTimeMs).toBeNull();
    expect(summary.avgOcrTimeMs).toBeNull();
    expect(summary.topErrors).toEqual([]);
  });

  it("computes summary correctly (totals, success rate, avg latency)", () => {
    const entries: InteractionLog[] = [
      {
        tweetId: "1",
        timestamp: "2026-03-23T10:00:00Z",
        ocrSuccess: true,
        replySent: true,
        totalTimeMs: 1000,
        ocrTimeMs: 500,
        variant: "A",
      },
      {
        tweetId: "2",
        timestamp: "2026-03-23T11:00:00Z",
        ocrSuccess: true,
        replySent: true,
        totalTimeMs: 2000,
        ocrTimeMs: 700,
        variant: "A",
      },
      {
        tweetId: "3",
        timestamp: "2026-03-23T12:00:00Z",
        ocrSuccess: false,
        replySent: false,
        totalTimeMs: 3000,
        ocrTimeMs: 200,
        variant: "B",
        error: "OCR failed",
      },
    ];

    const summary = computeSummary(entries);
    expect(summary.total).toBe(3);
    expect(summary.successes).toBe(2);
    expect(summary.failures).toBe(1);
    expect(summary.avgTotalTimeMs).toBe(2000);
    expect(summary.avgOcrTimeMs).toBeCloseTo(466.67, 0);
    expect(summary.variantDistribution).toEqual({ A: 2, B: 1 });
    expect(summary.topErrors).toEqual([{ error: "OCR failed", count: 1 }]);
  });
});

describe("getDateStringsForWindow", () => {
  it("handles date boundary (metrics spanning midnight)", () => {
    // A 48-hour window should produce at least 2 date strings
    const dates = getDateStringsForWindow(48);
    expect(dates.length).toBeGreaterThanOrEqual(2);

    // All dates should be YYYY-MM-DD format
    for (const d of dates) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
