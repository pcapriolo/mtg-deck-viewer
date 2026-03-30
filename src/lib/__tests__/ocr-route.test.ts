import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Anthropic SDK before importing the route
const mockMessagesCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })),
}));

import { POST } from "@/app/api/ocr/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Build a fake Anthropic messages.create response with a single text block. */
function fakeAnthropicResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

const VALID_BASE64_IMAGE = "data:image/jpeg;base64,/9j/abc123==";
const SAMPLE_DECKLIST = "4 Lightning Bolt\n20 Mountain";

describe("POST /api/ocr", () => {
  const originalEnv = { ...process.env };
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key-abc";
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    globalThis.fetch = originalFetch;
  });

  // ── Auth guard ───────────────────────────────────────────────────────────────

  it("returns 500 when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const res = await POST(makeRequest({ image: VALID_BASE64_IMAGE }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("ANTHROPIC_API_KEY");
  });

  // ── Input validation ─────────────────────────────────────────────────────────

  it("returns 400 when neither image nor imageUrl is provided", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeTruthy();
  });

  it("returns 400 when image is not a valid base64 data URL", async () => {
    const res = await POST(makeRequest({ image: "not-a-data-url" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid image format");
  });

  it("returns 400 when imageUrl fetch fails", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, headers: { get: () => null } });

    const res = await POST(makeRequest({ imageUrl: "https://example.com/deck.jpg" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Failed to fetch image from URL");
  });

  // ── Successful extraction ────────────────────────────────────────────────────

  it("returns 200 with decklist on successful base64 image extraction", async () => {
    // Pass 1 returns raw decklist; Pass 2 confirms it unchanged
    mockMessagesCreate
      .mockResolvedValueOnce(fakeAnthropicResponse(SAMPLE_DECKLIST))
      .mockResolvedValueOnce(fakeAnthropicResponse(SAMPLE_DECKLIST));

    const res = await POST(makeRequest({ image: VALID_BASE64_IMAGE }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.decklist).toContain("Lightning Bolt");
    expect(json.raw_pass1).toBe(SAMPLE_DECKLIST);
    expect(json.raw_pass2).toBe(SAMPLE_DECKLIST);
  });

  it("fetches imageUrl, converts to base64, and returns 200 with decklist", async () => {
    const fakeBuffer = new ArrayBuffer(8);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => fakeBuffer,
    });
    mockMessagesCreate
      .mockResolvedValueOnce(fakeAnthropicResponse(SAMPLE_DECKLIST))
      .mockResolvedValueOnce(fakeAnthropicResponse(SAMPLE_DECKLIST));

    const res = await POST(makeRequest({ imageUrl: "https://cdn.example.com/deck.png" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.decklist).toContain("Lightning Bolt");
  });

  it("uses pass 2 (eval-corrected) decklist when it produces valid output", async () => {
    const corrected = "4 Lightning Bolt\n4 Goblin Guide\n16 Mountain";
    mockMessagesCreate
      .mockResolvedValueOnce(fakeAnthropicResponse(SAMPLE_DECKLIST))
      .mockResolvedValueOnce(fakeAnthropicResponse(corrected));

    const res = await POST(makeRequest({ image: VALID_BASE64_IMAGE }));
    const json = await res.json();
    expect(json.decklist).toContain("Goblin Guide");
  });

  it("falls back to pass 1 when pass 2 returns empty text", async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(fakeAnthropicResponse(SAMPLE_DECKLIST))
      .mockResolvedValueOnce(fakeAnthropicResponse("   "));

    const res = await POST(makeRequest({ image: VALID_BASE64_IMAGE }));
    const json = await res.json();
    expect(json.decklist).toContain("Lightning Bolt");
  });

  it("strips preamble text before the first card line", async () => {
    const withPreamble = "Here is your decklist:\nSure! Let me extract:\n4 Lightning Bolt\n20 Mountain";
    mockMessagesCreate
      .mockResolvedValueOnce(fakeAnthropicResponse(withPreamble))
      .mockResolvedValueOnce(fakeAnthropicResponse(withPreamble));

    const res = await POST(makeRequest({ image: VALID_BASE64_IMAGE }));
    const json = await res.json();
    // The cleanResponse should strip "Here is your decklist:" preamble
    expect(json.decklist).not.toContain("Here is your decklist");
    expect(json.decklist).toContain("Lightning Bolt");
  });

  // ── Error handling ───────────────────────────────────────────────────────────

  it("returns 500 when Anthropic API throws", async () => {
    mockMessagesCreate.mockRejectedValue(new Error("overloaded_error"));

    const res = await POST(makeRequest({ image: VALID_BASE64_IMAGE }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("overloaded_error");
  });
});
