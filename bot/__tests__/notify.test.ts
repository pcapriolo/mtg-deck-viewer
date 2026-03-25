import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTelegramAlert } from "../notify";

describe("sendTelegramAlert", () => {
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.useFakeTimers();
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = mockFetch;
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "test-chat-id";
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    process.env.TELEGRAM_BOT_TOKEN = originalEnv.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_CHAT_ID = originalEnv.TELEGRAM_CHAT_ID;
  });

  it("sends message via Telegram API and returns true", async () => {
    const result = await sendTelegramAlert("Test alert");

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe("test-chat-id");
    expect(body.text).toBe("Test alert");
  });

  it("handles API error gracefully (no throw, returns false)", async () => {
    mockFetch.mockRejectedValue(new Error("API error"));
    const promise = sendTelegramAlert("Test");
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe(false);
  });

  it("retries once on failure then succeeds", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("transient error"))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const promise = sendTelegramAlert("Test retry");
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns false after two consecutive failures", async () => {
    mockFetch.mockRejectedValue(new Error("persistent error"));
    const promise = sendTelegramAlert("Test");
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("truncates messages > 4096 chars", async () => {
    const longMessage = "x".repeat(5000);
    await sendTelegramAlert(longMessage);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text.length).toBeLessThanOrEqual(4096);
    expect(body.text).toContain("...(truncated)");
  });

  it("returns false and warns when TELEGRAM_BOT_TOKEN missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const result = await sendTelegramAlert("Test");
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns false and warns when TELEGRAM_CHAT_ID missing", async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    const result = await sendTelegramAlert("Test");
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses Markdown parse mode", async () => {
    await sendTelegramAlert("*bold* test");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.parse_mode).toBe("Markdown");
  });
});
