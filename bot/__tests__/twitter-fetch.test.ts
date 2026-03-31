import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchMentions, fetchTweet } from "../twitter";

// ── fetchMentions ─────────────────────────────────────────────────────────────

describe("fetchMentions", () => {
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
    process.env.X_BEARER_TOKEN = "test-bearer-token";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.X_BEARER_TOKEN = originalEnv.X_BEARER_TOKEN;
  });

  function makeApiResponse(overrides: Record<string, unknown> = {}) {
    return {
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: "tweet-1",
              text: "@MtgViewer check this deck",
              author_id: "user-1",
              conversation_id: "conv-1",
              created_at: "2026-03-27T10:00:00Z",
              attachments: { media_keys: ["media-1"] },
            },
          ],
          includes: {
            media: [{ media_key: "media-1", type: "photo", url: "https://pbs.twimg.com/image.jpg" }],
            users: [{ id: "user-1", username: "deckbuilder" }],
          },
          ...overrides,
        }),
    };
  }

  it("returns parsed tweets with image URLs and usernames", async () => {
    mockFetch.mockResolvedValue(makeApiResponse());

    const tweets = await fetchMentions({} as any, "bot-id");

    expect(tweets).toHaveLength(1);
    const t = tweets[0];
    expect(t.id).toBe("tweet-1");
    expect(t.text).toBe("@MtgViewer check this deck");
    expect(t.authorId).toBe("user-1");
    expect(t.authorUsername).toBe("deckbuilder");
    expect(t.conversationId).toBe("conv-1");
    expect(t.imageUrls).toEqual(["https://pbs.twimg.com/image.jpg"]);
    expect(t.createdAt).toBe("2026-03-27T10:00:00Z");
  });

  it("includes sinceId in query params when provided", async () => {
    mockFetch.mockResolvedValue(makeApiResponse());

    await fetchMentions({} as any, "bot-id", "12345");

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("since_id=12345");
  });

  it("omits sinceId param when not provided", async () => {
    mockFetch.mockResolvedValue(makeApiResponse());

    await fetchMentions({} as any, "bot-id");

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).not.toContain("since_id");
  });

  it("returns empty array on API error (non-200)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, statusText: "Service Unavailable" });

    const tweets = await fetchMentions({} as any, "bot-id");
    expect(tweets).toEqual([]);
  });

  it("returns empty array when response has no data field", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ includes: {} }),
    });

    const tweets = await fetchMentions({} as any, "bot-id");
    expect(tweets).toEqual([]);
  });

  it("returns tweet with empty imageUrls when no media attached", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: "tweet-2",
              text: "@MtgViewer text only",
              author_id: "user-2",
              conversation_id: "conv-2",
              created_at: "2026-03-27T11:00:00Z",
            },
          ],
          includes: { users: [{ id: "user-2", username: "noimage" }] },
        }),
    });

    const tweets = await fetchMentions({} as any, "bot-id");
    expect(tweets).toHaveLength(1);
    expect(tweets[0].imageUrls).toEqual([]);
  });

  it("extracts inReplyToId from referenced_tweets", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: "tweet-3",
              text: "@MtgViewer reply",
              author_id: "user-3",
              conversation_id: "conv-3",
              created_at: "2026-03-27T12:00:00Z",
              referenced_tweets: [{ type: "replied_to", id: "parent-tweet" }],
            },
          ],
          includes: { users: [{ id: "user-3", username: "replier" }] },
        }),
    });

    const tweets = await fetchMentions({} as any, "bot-id");
    expect(tweets[0].inReplyToId).toBe("parent-tweet");
  });

  it("uses Bearer token in Authorization header", async () => {
    mockFetch.mockResolvedValue(makeApiResponse());

    await fetchMentions({} as any, "bot-id");

    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-bearer-token"
    );
  });
});

// ── fetchTweet ────────────────────────────────────────────────────────────────

describe("fetchTweet", () => {
  it("returns parsed tweet with images and username", async () => {
    const mockReader = {
      v2: {
        singleTweet: vi.fn().mockResolvedValue({
          data: {
            id: "tweet-10",
            text: "Check my deck",
            author_id: "user-10",
            conversation_id: "conv-10",
            created_at: "2026-03-27T14:00:00Z",
            attachments: { media_keys: ["m-1"] },
          },
          includes: {
            media: [{ media_key: "m-1", type: "photo", url: "https://pbs.twimg.com/deck.jpg" }],
            users: [{ id: "user-10", username: "mtgplayer" }],
          },
        }),
      },
    };

    const tweet = await fetchTweet(mockReader as any, "tweet-10");

    expect(tweet).not.toBeNull();
    expect(tweet!.id).toBe("tweet-10");
    expect(tweet!.authorUsername).toBe("mtgplayer");
    expect(tweet!.imageUrls).toEqual(["https://pbs.twimg.com/deck.jpg"]);
    expect(tweet!.conversationId).toBe("conv-10");
  });

  it("returns null when response data is missing", async () => {
    const mockReader = {
      v2: {
        singleTweet: vi.fn().mockResolvedValue({ data: null }),
      },
    };

    const tweet = await fetchTweet(mockReader as any, "tweet-11");
    expect(tweet).toBeNull();
  });

  it("returns null on API exception (network error)", async () => {
    const mockReader = {
      v2: {
        singleTweet: vi.fn().mockRejectedValue(new Error("Network timeout")),
      },
    };

    const tweet = await fetchTweet(mockReader as any, "tweet-12");
    expect(tweet).toBeNull();
  });

  it("returns empty imageUrls when tweet has no media attachments", async () => {
    const mockReader = {
      v2: {
        singleTweet: vi.fn().mockResolvedValue({
          data: {
            id: "tweet-13",
            text: "text only tweet",
            author_id: "user-13",
            conversation_id: "conv-13",
            created_at: "2026-03-27T15:00:00Z",
          },
          includes: {
            users: [{ id: "user-13", username: "textonly" }],
          },
        }),
      },
    };

    const tweet = await fetchTweet(mockReader as any, "tweet-13");
    expect(tweet!.imageUrls).toEqual([]);
  });

  it("extracts inReplyToId from referenced_tweets", async () => {
    const mockReader = {
      v2: {
        singleTweet: vi.fn().mockResolvedValue({
          data: {
            id: "tweet-14",
            text: "a reply",
            author_id: "user-14",
            conversation_id: "conv-14",
            created_at: "2026-03-27T16:00:00Z",
            referenced_tweets: [{ type: "replied_to", id: "parent-100" }],
          },
          includes: {
            users: [{ id: "user-14", username: "replier" }],
          },
        }),
      },
    };

    const tweet = await fetchTweet(mockReader as any, "tweet-14");
    expect(tweet!.inReplyToId).toBe("parent-100");
  });
});
