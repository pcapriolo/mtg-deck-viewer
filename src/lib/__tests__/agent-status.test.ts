import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fsp from "fs/promises";

// Mock fs/promises before importing the route
vi.mock("fs/promises");

import { GET } from "@/app/api/agent-status/route";

const PROGRESS_TEXT = "# Agent Progress\n- Tests: 273 passing";
const BACKLOG_JSON = JSON.stringify([{ id: "task-1", status: "ready" }]);
const HEARTBEAT_JSON = JSON.stringify({ IMPROVE: "2026-03-27T00:00:00Z" });

describe("GET /api/agent-status", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns all three files when they exist", async () => {
    vi.mocked(fsp.readFile)
      .mockResolvedValueOnce(PROGRESS_TEXT as never)    // claude-progress.txt
      .mockResolvedValueOnce(BACKLOG_JSON as never)     // feature-backlog.json
      .mockResolvedValueOnce(HEARTBEAT_JSON as never);  // agent-heartbeat.json

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.progress).toBe(PROGRESS_TEXT);
    expect(json.backlog).toEqual([{ id: "task-1", status: "ready" }]);
    expect(json.heartbeat).toEqual({ IMPROVE: "2026-03-27T00:00:00Z" });
  });

  it("returns null for progress when file is missing", async () => {
    vi.mocked(fsp.readFile)
      .mockRejectedValueOnce(new Error("ENOENT") as never)  // claude-progress.txt missing
      .mockResolvedValueOnce(BACKLOG_JSON as never)
      .mockResolvedValueOnce(HEARTBEAT_JSON as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.progress).toBeNull();
    expect(json.backlog).toEqual([{ id: "task-1", status: "ready" }]);
    expect(json.heartbeat).toEqual({ IMPROVE: "2026-03-27T00:00:00Z" });
  });

  it("returns null for backlog when file is missing", async () => {
    vi.mocked(fsp.readFile)
      .mockResolvedValueOnce(PROGRESS_TEXT as never)
      .mockRejectedValueOnce(new Error("ENOENT") as never)  // feature-backlog.json missing
      .mockResolvedValueOnce(HEARTBEAT_JSON as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.progress).toBe(PROGRESS_TEXT);
    expect(json.backlog).toBeNull();
    expect(json.heartbeat).toEqual({ IMPROVE: "2026-03-27T00:00:00Z" });
  });

  it("returns null for backlog when JSON is malformed", async () => {
    vi.mocked(fsp.readFile)
      .mockResolvedValueOnce(PROGRESS_TEXT as never)
      .mockResolvedValueOnce("not valid json" as never)    // malformed backlog
      .mockResolvedValueOnce(HEARTBEAT_JSON as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.backlog).toBeNull();
  });

  it("returns null for all files when all are missing", async () => {
    vi.mocked(fsp.readFile).mockRejectedValue(new Error("ENOENT") as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.progress).toBeNull();
    expect(json.backlog).toBeNull();
    expect(json.heartbeat).toBeNull();
  });

  it("response contains exactly the expected top-level keys", async () => {
    vi.mocked(fsp.readFile).mockRejectedValue(new Error("ENOENT") as never);

    const res = await GET();
    const json = await res.json();

    expect(Object.keys(json).sort()).toEqual(["backlog", "heartbeat", "progress"]);
  });
});
