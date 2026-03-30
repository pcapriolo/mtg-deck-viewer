import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock Prisma before importing the route
const mockCreate = vi.fn().mockResolvedValue({ id: "eval-run-id" });
const mockFindMany = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/db", () => ({
  prisma: {
    evalRun: {
      create: (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

import { POST, GET } from "@/app/api/eval-scores/route";

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/eval-scores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/api/eval-scores");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url.toString());
}

describe("POST /api/eval-scores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: "eval-run-id" });
  });

  it("returns 400 when caseCount is missing", async () => {
    const res = await POST(makePostRequest({ cardNameAccuracy: 0.9 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when cardNameAccuracy is missing", async () => {
    const res = await POST(makePostRequest({ caseCount: 10 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when both required fields are missing", async () => {
    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates eval run and returns ok:true with id on success", async () => {
    const body = {
      caseCount: 23,
      cardNameAccuracy: 0.87,
      quantityAccuracy: 0.91,
      countMatchRate: 0.78,
      scryfallResolved: 0.95,
      triggeredBy: "cron",
      commitSha: "abc1234",
    };

    const res = await POST(makePostRequest(body));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.id).toBe("eval-run-id");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.caseCount).toBe(23);
    expect(data.cardNameAccuracy).toBe(0.87);
    expect(data.quantityAccuracy).toBe(0.91);
    expect(data.countMatchRate).toBe(0.78);
    expect(data.scryfallResolved).toBe(0.95);
    expect(data.triggeredBy).toBe("cron");
    expect(data.commitSha).toBe("abc1234");
  });

  it("stores null for optional fields when not provided", async () => {
    const res = await POST(
      makePostRequest({ caseCount: 5, cardNameAccuracy: 0.6 })
    );
    expect(res.status).toBe(200);

    const data = mockCreate.mock.calls[0][0].data;
    expect(data.quantityAccuracy).toBeUndefined();
    expect(data.triggeredBy).toBeNull();
    expect(data.commitSha).toBeNull();
    expect(data.details).toBeNull();
  });

  it("returns 500 on database error", async () => {
    mockCreate.mockRejectedValueOnce(new Error("DB write failed"));

    const res = await POST(
      makePostRequest({ caseCount: 10, cardNameAccuracy: 0.8 })
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("DB write failed");
  });
});

describe("GET /api/eval-scores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
  });

  it("returns runs array on success", async () => {
    const fakeRuns = [
      { id: "run-1", caseCount: 20, cardNameAccuracy: 0.85, ranAt: new Date() },
      { id: "run-2", caseCount: 23, cardNameAccuracy: 0.9, ranAt: new Date() },
    ];
    mockFindMany.mockResolvedValueOnce(fakeRuns);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.runs).toHaveLength(2);
    expect(json.runs[0].id).toBe("run-1");
  });

  it("uses default limit=30 and days=90 when no params provided", async () => {
    await GET(makeGetRequest());

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const query = mockFindMany.mock.calls[0][0];
    expect(query.take).toBe(30);
    // since cutoff should be roughly 90 days ago
    const cutoff = query.where.ranAt.gte as Date;
    const daysDiff = (Date.now() - cutoff.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeGreaterThan(89);
    expect(daysDiff).toBeLessThan(91);
  });

  it("respects custom limit and days params", async () => {
    await GET(makeGetRequest({ limit: "10", days: "7" }));

    const query = mockFindMany.mock.calls[0][0];
    expect(query.take).toBe(10);
    const daysDiff =
      (Date.now() - (query.where.ranAt.gte as Date).getTime()) /
      (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeGreaterThan(6);
    expect(daysDiff).toBeLessThan(8);
  });

  it("caps limit at 100 even when a larger value is requested", async () => {
    await GET(makeGetRequest({ limit: "999" }));

    const query = mockFindMany.mock.calls[0][0];
    expect(query.take).toBe(100);
  });

  it("returns 500 on database error", async () => {
    mockFindMany.mockRejectedValueOnce(new Error("DB read failed"));

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("DB read failed");
  });
});
