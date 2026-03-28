import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma before importing the route
const mockCreate = vi.fn().mockResolvedValue({ id: "test-id" });
vi.mock("@/lib/db", () => ({
  prisma: {
    interaction: { create: (...args: unknown[]) => mockCreate(...args) },
  },
}));

import { POST } from "@/app/api/metrics/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/metrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when tweetId is missing", async () => {
    const res = await POST(makeRequest({ timestamp: "2026-03-27T10:00:00Z" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("tweetId");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when timestamp is missing", async () => {
    const res = await POST(makeRequest({ tweetId: "123456" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("timestamp");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when both required fields are missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates interaction record and returns ok:true on success", async () => {
    const body = {
      tweetId: "tweet-1",
      timestamp: "2026-03-27T10:00:00Z",
      ocrSuccess: true,
      ocrCardsExtracted: 60,
      replySent: true,
      mainboardCount: 60,
      sideboardCount: 15,
    };

    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.tweetId).toBe("tweet-1");
    expect(data.ocrSuccess).toBe(true);
    expect(data.ocrCardsExtracted).toBe(60);
    expect(data.replySent).toBe(true);
    expect(data.mainboardCount).toBe(60);
    expect(data.sideboardCount).toBe(15);
    expect(data.createdAt).toBeInstanceOf(Date);
  });

  it("applies defaults for optional fields when not provided", async () => {
    const res = await POST(
      makeRequest({ tweetId: "tweet-2", timestamp: "2026-03-27T11:00:00Z" })
    );
    expect(res.status).toBe(200);

    const data = mockCreate.mock.calls[0][0].data;
    expect(data.imageCount).toBe(0);
    expect(data.ocrSuccess).toBe(false);
    expect(data.ocrPassCount).toBe(0);
    expect(data.ocrCardsExtracted).toBe(0);
    expect(data.ocrTimeMs).toBe(0);
    expect(data.scryfallCardsResolved).toBe(0);
    expect(data.scryfallCardsNotFound).toEqual([]);
    expect(data.scryfallTimeMs).toBe(0);
    expect(data.replySent).toBe(false);
    expect(data.replyTimeMs).toBe(0);
    expect(data.mainboardCount).toBe(0);
    expect(data.sideboardCount).toBe(0);
    expect(data.totalTimeMs).toBe(0);
    expect(data.conversationId).toBeNull();
    expect(data.authorId).toBeNull();
    expect(data.deckName).toBeNull();
    expect(data.deckUrl).toBeNull();
    expect(data.utmId).toBeNull();
  });

  it("truncates tweetText to 280 characters", async () => {
    const longText = "x".repeat(400);
    const res = await POST(
      makeRequest({ tweetId: "tweet-3", timestamp: "2026-03-27T12:00:00Z", tweetText: longText })
    );
    expect(res.status).toBe(200);

    const data = mockCreate.mock.calls[0][0].data;
    expect(data.tweetText).toHaveLength(280);
  });

  it("returns 500 on database error", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Connection refused"));

    const res = await POST(
      makeRequest({ tweetId: "tweet-4", timestamp: "2026-03-27T13:00:00Z" })
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Connection refused");
  });
});
