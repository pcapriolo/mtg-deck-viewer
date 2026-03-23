import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTelegramAlert } from "../notify";

describe("sendTelegramAlert", () => {
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = mockFetch;
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "test-chat-id";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.TELEGRAM_BOT_TOKEN = originalEnv.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_CHAT_ID = originalEnv.TELEGRAM_CHAT_ID;
  });

  it("sends message via Telegram API", async () => {
    await sendTelegramAlert("Test alert");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe("test-chat-id");
    expect(body.text).toBe("Test alert");
  });

  it("handles API error gracefully (no throw)", async () => {
    mockFetch.mockRejectedValue(new Error("API error"));
    await expect(sendTelegramAlert("Test")).resolves.toBeUndefined();
  });

  it("truncates messages > 4096 chars", async () => {
    const longMessage = "x".repeat(5000);
    await sendTelegramAlert(longMessage);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text.length).toBeLessThanOrEqual(4096);
    expect(body.text).toContain("...(truncated)");
  });

  it("silently returns when TELEGRAM_BOT_TOKEN missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    await sendTelegramAlert("Test");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("silently returns when TELEGRAM_CHAT_ID missing", async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    await sendTelegramAlert("Test");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses Markdown parse mode", async () => {
    await sendTelegramAlert("*bold* test");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.parse_mode).toBe("Markdown");
  });
});
