import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma before importing the route
const mockFindFirst = vi.fn();
const mockFindMany = vi.fn();
const mockCount = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    interaction: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
    },
  },
}));

import { GET } from "@/app/api/stats/route";
import { NextRequest } from "next/server";

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/api/stats");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString(), { method: "GET" });
}

describe("GET /api/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("conversationId dedup check", () => {
    it("returns alreadyReplied:true when conversation exists with replySent:true", async () => {
      mockFindFirst.mockResolvedValueOnce({ id: "existing-id" });

      const res = await GET(makeRequest({ conversationId: "conv-123" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.alreadyReplied).toBe(true);

      expect(mockFindFirst).toHaveBeenCalledTimes(1);
      const args = mockFindFirst.mock.calls[0][0];
      expect(args.where.conversationId).toBe("conv-123");
      expect(args.where.replySent).toBe(true);
    });

    it("returns alreadyReplied:false when conversation not found", async () => {
      mockFindFirst.mockResolvedValueOnce(null);

      const res = await GET(makeRequest({ conversationId: "conv-999" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.alreadyReplied).toBe(false);
    });
  });

  describe("tweetId dedup check", () => {
    it("returns alreadyReplied:true when tweet exists with replySent:true", async () => {
      mockFindFirst.mockResolvedValueOnce({ id: "tweet-row-id" });
      mockCount.mockResolvedValueOnce(1);

      const res = await GET(makeRequest({ tweetId: "tweet-456" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.alreadyReplied).toBe(true);

      const findFirstArgs = mockFindFirst.mock.calls[0][0];
      expect(findFirstArgs.where.tweetId).toBe("tweet-456");
      expect(findFirstArgs.where.replySent).toBe(true);
    });

    it("returns alreadyReplied:false when tweet not found and attempt count < 3", async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockCount.mockResolvedValueOnce(2);

      const res = await GET(makeRequest({ tweetId: "tweet-000" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.alreadyReplied).toBe(false);
    });

    it("returns alreadyReplied:true when attempt count reaches 3 (permanent blacklist)", async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockCount.mockResolvedValueOnce(3);

      const res = await GET(makeRequest({ tweetId: "tweet-retry-loop" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.alreadyReplied).toBe(true);
    });

    it("returns alreadyReplied:true when attempt count exceeds 3", async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockCount.mockResolvedValueOnce(5);

      const res = await GET(makeRequest({ tweetId: "tweet-retried-many" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.alreadyReplied).toBe(true);
    });
  });

  describe("full stats query", () => {
    const sampleInteractions = [
      { id: "1", tweetId: "t1", replySent: true, createdAt: new Date() },
      { id: "2", tweetId: "t2", replySent: false, createdAt: new Date() },
    ];

    const sampleSummaryRows = [
      { ocrSuccess: true, replySent: true, totalTimeMs: 1000, ocrTimeMs: 400, replyVariant: "A", ocrCardsExtracted: 60 },
      { ocrSuccess: false, replySent: false, totalTimeMs: 500, ocrTimeMs: 200, replyVariant: "B", ocrCardsExtracted: 0 },
    ];

    it("returns interactions and computed summary", async () => {
      mockFindMany
        .mockResolvedValueOnce(sampleInteractions)
        .mockResolvedValueOnce(sampleSummaryRows);

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.interactions).toHaveLength(2);
      expect(json.summary.total).toBe(2);
      expect(json.summary.successes).toBe(1);
      expect(json.summary.failures).toBe(1);
      expect(json.summary.avgTotalTimeMs).toBe(750);
      expect(json.summary.avgOcrTimeMs).toBe(300);
      expect(json.summary.variantDistribution).toEqual({ A: 1, B: 1 });
    });

    it("applies default hours (24) and limit (100) when not specified", async () => {
      mockFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await GET(makeRequest());

      const firstCall = mockFindMany.mock.calls[0][0];
      expect(firstCall.take).toBe(100);
      expect(firstCall.where.createdAt.gte).toBeInstanceOf(Date);
    });

    it("respects custom hours and limit query params", async () => {
      mockFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await GET(makeRequest({ hours: "48", limit: "50" }));

      const firstCall = mockFindMany.mock.calls[0][0];
      expect(firstCall.take).toBe(50);
    });

    it("returns null for avgTotalTimeMs and avgOcrTimeMs when no interactions", async () => {
      mockFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.summary.total).toBe(0);
      expect(json.summary.avgTotalTimeMs).toBeNull();
      expect(json.summary.avgOcrTimeMs).toBeNull();
    });
  });

  describe("error handling", () => {
    it("returns 500 when database throws", async () => {
      mockFindFirst.mockRejectedValueOnce(new Error("DB connection lost"));

      const res = await GET(makeRequest({ conversationId: "conv-err" }));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("DB connection lost");
    });
  });
});
