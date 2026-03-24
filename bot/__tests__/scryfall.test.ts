import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchCards } from "../scryfall";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function scryfallResponse(cards: Array<{ name: string }>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      object: "list",
      data: cards.map((c) => ({
        name: c.name,
        colors: [],
        color_identity: [],
        type_line: "Instant",
        prices: { usd: "1.00" },
      })),
    }),
  };
}

describe("fetchCards", () => {
  it("returns empty object for empty input", async () => {
    const result = await fetchCards([]);
    expect(result).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches cards and indexes by lowercase name", async () => {
    mockFetch.mockResolvedValueOnce(scryfallResponse([{ name: "Lightning Bolt" }]));

    const result = await fetchCards(["Lightning Bolt"]);
    expect(result["lightning bolt"]).toBeDefined();
    expect(result["lightning bolt"].name).toBe("Lightning Bolt");
  });

  it("deduplicates input names", async () => {
    mockFetch.mockResolvedValueOnce(scryfallResponse([{ name: "Lightning Bolt" }]));

    await fetchCards(["Lightning Bolt", "Lightning Bolt", "lightning bolt"]);
    // Should only send one batch with deduplicated names
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // "Lightning Bolt" and "lightning bolt" are different strings but after trim+filter
    // the Set dedupes exact matches only
    expect(body.identifiers.length).toBeLessThanOrEqual(2);
  });

  it("indexes split card faces separately", async () => {
    mockFetch.mockResolvedValueOnce(
      scryfallResponse([{ name: "Fire // Ice" }])
    );

    const result = await fetchCards(["Fire // Ice"]);
    expect(result["fire // ice"]).toBeDefined();
    expect(result["fire"]).toBeDefined();
    expect(result["ice"]).toBeDefined();
    // All point to the same card
    expect(result["fire"].name).toBe("Fire // Ice");
  });

  it("retries on 429 with exponential backoff", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce(scryfallResponse([{ name: "Lightning Bolt" }]));

    const result = await fetchCards(["Lightning Bolt"]);
    expect(result["lightning bolt"]).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to fuzzy search for missing cards", async () => {
    // Batch returns empty
    mockFetch.mockResolvedValueOnce(scryfallResponse([]));
    // Fuzzy returns the card
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: "Lightning Bolt",
        colors: ["R"],
        color_identity: ["R"],
        type_line: "Instant",
        prices: { usd: "1.00" },
      }),
    });

    const result = await fetchCards(["Lightening Bolt"]);
    expect(result["lightning bolt"]).toBeDefined();
    expect(result["lightening bolt"]).toBeDefined(); // indexed by misspelled name too
  });

  it("handles batch API failure gracefully", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await fetchCards(["Lightning Bolt"]);
    // Batch fails, fuzzy also fails → empty result
    expect(Object.keys(result).length).toBe(0);
  });

  it("handles malformed JSON response gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ object: "error" }), // not a list
    });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 }); // fuzzy fails

    const result = await fetchCards(["Lightning Bolt"]);
    expect(Object.keys(result).length).toBe(0);
  });
});
