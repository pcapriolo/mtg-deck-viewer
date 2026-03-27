import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}));

describe("GET /api/bot-health", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ uptime: 42.5, status: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubGlobal("AbortSignal", { timeout: vi.fn(() => ({})) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("fetches with cache: no-store so watchdog never reads stale uptime", async () => {
    const { GET } = await import("@/app/api/bot-health/route");
    await GET();
    expect(mockFetch).toHaveBeenCalledOnce();
    const [, options] = mockFetch.mock.calls[0];
    expect(options.cache).toBe("no-store");
  });

  it("returns bot health data when bot is reachable", async () => {
    const healthData = { uptime: 42.5, status: "ok", pollCount: 10 };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(healthData),
    });
    const { GET } = await import("@/app/api/bot-health/route");
    const response = await GET();
    expect(response.body).toEqual(healthData);
    expect(response.status).toBe(200);
  });

  it("returns 502 when bot responds with HTTP error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    const { GET } = await import("@/app/api/bot-health/route");
    const response = await GET();
    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ status: "unreachable" });
  });

  it("returns 502 when bot fetch throws (network error / timeout)", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const { GET } = await import("@/app/api/bot-health/route");
    const response = await GET();
    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ status: "unreachable" });
  });
});
