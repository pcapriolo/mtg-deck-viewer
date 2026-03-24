import { describe, it, expect } from "vitest";
import {
  parseJsonl,
  filterByTimeWindow,
  computeSummary,
  getDateStringsForWindow,
} from "../metrics-storage";

describe("parseJsonl", () => {
  it("parses valid JSONL lines", () => {
    const content = '{"tweetId":"1","timestamp":"2026-03-23T12:00:00Z"}\n{"tweetId":"2","timestamp":"2026-03-23T13:00:00Z"}';
    const result = parseJsonl(content);
    expect(result).toHaveLength(2);
    expect(result[0].tweetId).toBe("1");
    expect(result[1].tweetId).toBe("2");
  });

  it("skips empty lines", () => {
    const content = '{"tweetId":"1","timestamp":"2026-03-23T12:00:00Z"}\n\n\n{"tweetId":"2","timestamp":"2026-03-23T13:00:00Z"}';
    expect(parseJsonl(content)).toHaveLength(2);
  });

  it("skips malformed lines without throwing", () => {
    const content = '{"tweetId":"1","timestamp":"2026-03-23T12:00:00Z"}\nnot json\n{"tweetId":"2","timestamp":"2026-03-23T13:00:00Z"}';
    expect(parseJsonl(content)).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(parseJsonl("")).toHaveLength(0);
  });
});

describe("filterByTimeWindow", () => {
  it("filters entries within the time window", () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 30 * 60 * 1000).toISOString(); // 30 min ago
    const old = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(); // 3 hours ago

    const entries = [
      { tweetId: "1", timestamp: recent },
      { tweetId: "2", timestamp: old },
    ];

    const result = filterByTimeWindow(entries, 1); // 1 hour window
    expect(result).toHaveLength(1);
    expect(result[0].tweetId).toBe("1");
  });

  it("returns all entries when window is large enough", () => {
    const now = new Date();
    const entries = [
      { tweetId: "1", timestamp: new Date(now.getTime() - 60000).toISOString() },
      { tweetId: "2", timestamp: new Date(now.getTime() - 120000).toISOString() },
    ];
    expect(filterByTimeWindow(entries, 24)).toHaveLength(2);
  });
});

describe("computeSummary", () => {
  it("computes correct totals and success rate", () => {
    const entries = [
      { tweetId: "1", timestamp: "2026-03-23T12:00:00Z", ocrSuccess: true, replySent: true, totalTimeMs: 5000, ocrTimeMs: 3000 },
      { tweetId: "2", timestamp: "2026-03-23T13:00:00Z", ocrSuccess: false, replySent: false, totalTimeMs: 2000, ocrTimeMs: 1500 },
      { tweetId: "3", timestamp: "2026-03-23T14:00:00Z", ocrSuccess: true, replySent: true, totalTimeMs: 4000, ocrTimeMs: 2500 },
    ];
    const summary = computeSummary(entries);
    expect(summary.total).toBe(3);
    expect(summary.successes).toBe(2);
    expect(summary.failures).toBe(1);
    expect(summary.avgTotalTimeMs).toBeCloseTo(3666.67, 0);
    expect(summary.avgOcrTimeMs).toBeCloseTo(2333.33, 0);
  });

  it("handles empty entries", () => {
    const summary = computeSummary([]);
    expect(summary.total).toBe(0);
    expect(summary.successes).toBe(0);
    expect(summary.avgTotalTimeMs).toBeNull();
    expect(summary.avgOcrTimeMs).toBeNull();
  });

  it("counts variant distribution", () => {
    const entries = [
      { tweetId: "1", timestamp: "t", variant: "A" },
      { tweetId: "2", timestamp: "t", variant: "A" },
      { tweetId: "3", timestamp: "t", variant: "B" },
    ];
    const summary = computeSummary(entries);
    expect(summary.variantDistribution).toEqual({ A: 2, B: 1 });
  });

  it("counts top errors", () => {
    const entries = [
      { tweetId: "1", timestamp: "t", error: "timeout" },
      { tweetId: "2", timestamp: "t", error: "timeout" },
      { tweetId: "3", timestamp: "t", error: "auth" },
    ];
    const summary = computeSummary(entries);
    expect(summary.topErrors[0]).toEqual({ error: "timeout", count: 2 });
    expect(summary.topErrors[1]).toEqual({ error: "auth", count: 1 });
  });
});

describe("getDateStringsForWindow", () => {
  it("returns today for a 1-hour window", () => {
    const dates = getDateStringsForWindow(1);
    expect(dates.length).toBeGreaterThanOrEqual(1);
    const today = new Date().toISOString().slice(0, 10);
    expect(dates).toContain(today);
  });

  it("returns multiple dates for a 48-hour window", () => {
    const dates = getDateStringsForWindow(48);
    expect(dates.length).toBeGreaterThanOrEqual(2);
  });
});
