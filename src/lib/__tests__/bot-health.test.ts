import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/bot-health/route";

describe("GET /api/bot-health", () => {
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.BOT_HEALTH_URL = originalEnv.BOT_HEALTH_URL;
  });

  it("proxies bot health data and returns 200 on success", async () => {
    const botData = { status: "ok", uptime: 1234, lastPollAt: "2026-03-27T00:00:00Z" };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => botData,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    // checkedAt is added by the route to make stale responses detectable
    expect(json).toMatchObject(botData);
    expect(typeof json.checkedAt).toBe("string");
  });

  it("includes Cache-Control: no-store header so Railway edge does not cache the response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok", uptime: 100 }),
    });

    const res = await GET();
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("returns 502 when bot responds with non-ok status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    const res = await GET();
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.status).toBe("unreachable");
    expect(json.error).toBe("HTTP 503");
  });

  it("returns 502 when fetch throws (network error / timeout)", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await GET();
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.status).toBe("unreachable");
  });

  it("uses BOT_HEALTH_URL env var when set", async () => {
    process.env.BOT_HEALTH_URL = "http://custom-bot:3001/health";
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
    });

    await GET();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://custom-bot:3001/health",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("falls back to localhost:3001/health when BOT_HEALTH_URL is not set", async () => {
    delete process.env.BOT_HEALTH_URL;
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
    });

    await GET();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/health",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });
});
