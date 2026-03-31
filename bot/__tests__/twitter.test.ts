import { describe, it, expect, vi } from "vitest";
import { deleteTweet, replyWithLink } from "../twitter";

function mockWriter(behavior: "success" | "404" | "429" | "error") {
  const mock = {
    v2: {
      deleteTweet: vi.fn(),
      tweet: vi.fn(),
    },
  };
  switch (behavior) {
    case "success":
      mock.v2.deleteTweet.mockResolvedValue({ data: { deleted: true } });
      break;
    case "404":
      mock.v2.deleteTweet.mockRejectedValue({ code: 404 });
      break;
    case "429":
      mock.v2.deleteTweet.mockRejectedValue({ code: 429 });
      break;
    case "error":
      mock.v2.deleteTweet.mockRejectedValue(new Error("Unknown error"));
      break;
  }
  return mock;
}

describe("replyWithLink", () => {
  it("replaces placeholder with deck URL and returns tweet id", async () => {
    const writer = {
      v2: {
        tweet: vi.fn().mockResolvedValue({ data: { id: "reply-tweet-id" } }),
      },
    };
    const replyText = "Burn · 60 cards\n🔴\n\n▶ View deck →";
    const deckUrl = "https://mtgdeck.app/d/abc123";

    const id = await replyWithLink(writer as any, "original-id", deckUrl, replyText);

    expect(id).toBe("reply-tweet-id");
    expect(writer.v2.tweet).toHaveBeenCalledTimes(1);
    const [payload] = writer.v2.tweet.mock.calls[0];
    expect(payload.text).toContain(deckUrl);
    expect(payload.text).not.toContain("▶ View deck →\n");
    expect(payload.reply.in_reply_to_tweet_id).toBe("original-id");
  });

  it("injects URL inline after the arrow placeholder", async () => {
    const writer = {
      v2: {
        tweet: vi.fn().mockResolvedValue({ data: { id: "tweet-99" } }),
      },
    };
    const url = "https://mtgdeck.app/d/xyz";
    const replyText = "60-card deck\n\n▶ View deck →";

    await replyWithLink(writer as any, "parent-id", url, replyText);

    const sentText: string = writer.v2.tweet.mock.calls[0][0].text;
    expect(sentText).toBe(`60-card deck\n\n▶ View deck → ${url}`);
  });

  it("forwards the reply tweet id back to the caller", async () => {
    const writer = {
      v2: {
        tweet: vi.fn().mockResolvedValue({ data: { id: "forwarded-123" } }),
      },
    };

    const result = await replyWithLink(writer as any, "any-id", "https://example.com/d/foo", "some text ▶ View deck →");
    expect(result).toBe("forwarded-123");
  });

  it("propagates API errors to the caller", async () => {
    const writer = {
      v2: {
        tweet: vi.fn().mockRejectedValue(new Error("Twitter API error")),
      },
    };

    await expect(
      replyWithLink(writer as any, "id", "https://example.com/d/abc", "▶ View deck →")
    ).rejects.toThrow("Twitter API error");
  });
});

describe("deleteTweet", () => {
  it("returns true on successful deletion", async () => {
    const writer = mockWriter("success");
    const result = await deleteTweet(writer as any, "123");
    expect(result).toBe(true);
    expect(writer.v2.deleteTweet).toHaveBeenCalledWith("123");
  });

  it("returns true when tweet already gone (404)", async () => {
    const writer = mockWriter("404");
    const result = await deleteTweet(writer as any, "123");
    expect(result).toBe(true);
  });

  it("returns false when rate limited (429)", async () => {
    const writer = mockWriter("429");
    const result = await deleteTweet(writer as any, "123");
    expect(result).toBe(false);
  });

  it("returns false on unknown error", async () => {
    const writer = mockWriter("error");
    const result = await deleteTweet(writer as any, "123");
    expect(result).toBe(false);
  });
});
