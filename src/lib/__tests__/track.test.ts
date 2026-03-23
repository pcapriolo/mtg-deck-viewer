import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";

// Mock fs before importing the route
vi.mock("fs", () => {
  return {
    default: {
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      appendFileSync: vi.fn(),
    },
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
  };
});

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

  it("appends engagement event to JSONL", async () => {
    const res = await POST(makeRequest({ utmId: "utm-123", timestamp: "2026-03-23T10:00:00Z" }));
    expect(res.status).toBe(200);

    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    const written = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    const parsed = JSON.parse(written.trim());
    expect(parsed.utmId).toBe("utm-123");
    expect(parsed.timestamp).toBe("2026-03-23T10:00:00Z");
    expect(parsed.userAgent).toBe("TestBot/1.0");
  });

  it("adds server timestamp when not provided", async () => {
    const before = new Date().toISOString();
    const res = await POST(makeRequest({ utmId: "utm-456" }));
    expect(res.status).toBe(200);

    const written = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    const parsed = JSON.parse(written.trim());
    expect(parsed.utmId).toBe("utm-456");
    // Server timestamp should be recent
    expect(parsed.timestamp >= before).toBe(true);
  });

  it("handles write errors gracefully", async () => {
    (fs.appendFileSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("Disk full");
    });

    const res = await POST(makeRequest({ utmId: "utm-789" }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Disk full");
  });
});
