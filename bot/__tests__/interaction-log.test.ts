import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logInteraction, InteractionLog } from "../interaction-log";

function makeLog(overrides: Partial<InteractionLog> = {}): InteractionLog {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    tweetId: "123456",
    authorId: "789",
    authorUsername: "testuser",
    tweetText: "test tweet",
    imageCount: 1,
    ocrSuccess: true,
    ocrPassCount: 1,
    ocrCardsExtracted: 10,
    ocrTimeMs: 500,
    ocrErrors: [],
    scryfallCardsResolved: 10,
    scryfallCardsNotFound: [],
    scryfallTimeMs: 200,
    replySent: true,
    replyTweetId: "reply123",
    replyFormatVariant: "base",
    replyTimeMs: 100,
    totalTimeMs: 800,
    deckName: "Test Deck",
    mainboardCount: 60,
    sideboardCount: 15,
    utmId: "abc-123",
    errors: [],
    ...overrides,
  };
}

describe("logInteraction", () => {
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("logs interaction via POST", async () => {
    await logInteraction(makeLog());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/metrics");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("handles network error gracefully (no throw)", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    await expect(logInteraction(makeLog())).resolves.toBeUndefined();
  });

  it("handles web app returning 500 (no throw)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(logInteraction(makeLog())).resolves.toBeUndefined();
  });

  it("includes all required fields", async () => {
    const log = makeLog();
    await logInteraction(log);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tweetId).toBe(log.tweetId);
    expect(body.authorId).toBe(log.authorId);
    expect(body.authorUsername).toBe(log.authorUsername);
    expect(body.ocrSuccess).toBe(true);
    expect(body.scryfallCardsResolved).toBe(10);
    expect(body.replySent).toBe(true);
    expect(body.utmId).toBe(log.utmId);
    expect(body.mainboardCount).toBe(60);
    expect(body.sideboardCount).toBe(15);
  });

  it("truncates tweetText to 280 chars", async () => {
    const longText = "a".repeat(500);
    await logInteraction(makeLog({ tweetText: longText }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tweetText.length).toBe(280);
  });

  it("generates valid UUID for id", async () => {
    const log = makeLog();
    await logInteraction(log);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("uses correct URL from DECK_VIEWER_URL env", async () => {
    await logInteraction(makeLog());

    const url = mockFetch.mock.calls[0][0] as string;
    // Default is http://localhost:3000 when env not set
    expect(url).toMatch(/\/api\/metrics$/);
  });

  it("handles missing DECK_VIEWER_URL (no throw)", async () => {
    // Even with default URL, the fetch might fail — should still not throw
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(logInteraction(makeLog())).resolves.toBeUndefined();
  });
});
