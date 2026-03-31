import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma before importing the route
const mockCreate = vi.fn().mockResolvedValue({ id: "test-id" });
vi.mock("@/lib/db", () => ({
  prisma: {
    engagement: { create: (...args: unknown[]) => mockCreate(...args) },
  },
}));

import { POST } from "@/app/api/track/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "TestBot/1.0" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/track", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when utmId is missing", async () => {
    const res = await POST(makeRequest({ timestamp: "2026-03-23T10:00:00Z" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("utmId");
  });

  it("creates engagement record in database", async () => {
    const res = await POST(makeRequest({ utmId: "utm-123" }));
    expect(res.status).toBe(200);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.utmId).toBe("utm-123");
    expect(data.userAgent).toBe("TestBot/1.0");
  });

  it("handles database errors gracefully", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Connection refused"));

    const res = await POST(makeRequest({ utmId: "utm-789" }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Connection refused");
  });

  it("returns 400 when body is invalid JSON", async () => {
    const req = new NextRequest("http://localhost:3000/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json {[",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid JSON body");
  });
});
