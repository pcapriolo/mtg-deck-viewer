import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractDecklistFromImage, extractDecklistFromUrl } from "../ocr";

describe("extractDecklistFromImage", () => {
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns decklist on successful response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ decklist: "4 Lightning Bolt\n4 Counterspell" }),
    });

    const result = await extractDecklistFromImage("data:image/png;base64,abc");
    expect(result).toBe("4 Lightning Bolt\n4 Counterspell");
  });

  it("POSTs image to /api/ocr with correct body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ decklist: "1 Island" }),
    });

    await extractDecklistFromImage("data:image/png;base64,xyz");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/ocr",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: "data:image/png;base64,xyz" }),
      }),
    );
  });

  it("calls onProgress at 10, 80, and 100", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ decklist: "1 Island" }),
    });

    const progress: number[] = [];
    await extractDecklistFromImage("data:image/png;base64,abc", (p) => progress.push(p));
    expect(progress).toEqual([10, 80, 100]);
  });

  it("throws with server error message when response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Claude Vision unavailable" }),
    });

    await expect(extractDecklistFromImage("data:image/png;base64,bad")).rejects.toThrow(
      "Claude Vision unavailable",
    );
  });

  it("throws fallback message when error response has no JSON body", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => { throw new Error("not json"); },
    });

    await expect(extractDecklistFromImage("data:image/png;base64,bad")).rejects.toThrow(
      "OCR request failed",
    );
  });

  it("throws when network fetch rejects", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(extractDecklistFromImage("data:image/png;base64,abc")).rejects.toThrow(
      "ECONNREFUSED",
    );
  });

  it("throws when decklist is empty string", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ decklist: "" }),
    });

    await expect(extractDecklistFromImage("data:image/png;base64,abc")).rejects.toThrow(
      "Could not extract any card names from the image.",
    );
  });

  it("throws when decklist is whitespace only", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ decklist: "   \n  " }),
    });

    await expect(extractDecklistFromImage("data:image/png;base64,abc")).rejects.toThrow(
      "Could not extract any card names from the image.",
    );
  });

  it("throws when decklist field is missing from response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await expect(extractDecklistFromImage("data:image/png;base64,abc")).rejects.toThrow(
      "Could not extract any card names from the image.",
    );
  });
});

describe("extractDecklistFromUrl", () => {
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns decklist on successful response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ decklist: "4 Dark Ritual\n4 Thoughtseize" }),
    });

    const result = await extractDecklistFromUrl("https://example.com/deck.png");
    expect(result).toBe("4 Dark Ritual\n4 Thoughtseize");
  });

  it("POSTs imageUrl to /api/ocr with correct body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ decklist: "1 Swamp" }),
    });

    await extractDecklistFromUrl("https://example.com/deck.png");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/ocr",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: "https://example.com/deck.png" }),
      }),
    );
  });

  it("calls onProgress at 10, 80, and 100", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ decklist: "1 Swamp" }),
    });

    const progress: number[] = [];
    await extractDecklistFromUrl("https://example.com/deck.png", (p) => progress.push(p));
    expect(progress).toEqual([10, 80, 100]);
  });

  it("throws with server error message when response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "upstream error" }),
    });

    await expect(extractDecklistFromUrl("https://example.com/deck.png")).rejects.toThrow(
      "upstream error",
    );
  });

  it("throws fallback message when error response has no JSON body", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error("not json"); },
    });

    await expect(extractDecklistFromUrl("https://example.com/deck.png")).rejects.toThrow(
      "OCR request failed",
    );
  });

  it("throws when network fetch rejects", async () => {
    mockFetch.mockRejectedValue(new Error("fetch failed"));

    await expect(extractDecklistFromUrl("https://example.com/deck.png")).rejects.toThrow(
      "fetch failed",
    );
  });

  it("throws when decklist is empty", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ decklist: "" }),
    });

    await expect(extractDecklistFromUrl("https://example.com/deck.png")).rejects.toThrow(
      "Could not extract any card names from the image.",
    );
  });

  it("throws when decklist field is missing from response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await expect(extractDecklistFromUrl("https://example.com/deck.png")).rejects.toThrow(
      "Could not extract any card names from the image.",
    );
  });
});
