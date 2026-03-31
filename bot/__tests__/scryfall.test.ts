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

  it("resolves misspelled name via autocomplete prefix strategy", async () => {
    // Step 1: Batch returns empty — "Lightnig Bolt" not found
    mockFetch.mockResolvedValueOnce(scryfallResponse([]));
    // Step 2: Fuzzy search fails
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    // Step 3: Autocomplete returns "Lightning Bolt" as candidate
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: ["Lightning Bolt"] }),
    });
    // Step 4: Named lookup returns the card
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

    const result = await fetchCards(["Lightnig Bolt"]);
    expect(result["lightning bolt"]).toBeDefined();
    expect(result["lightning bolt"].name).toBe("Lightning Bolt");
    // Also indexed by the misspelled name
    expect(result["lightnig bolt"]).toBeDefined();
  });

  it("skips autocomplete candidate when Levenshtein distance exceeds 5", async () => {
    // Batch fails
    mockFetch.mockResolvedValueOnce(scryfallResponse([]));
    // Fuzzy fails
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    // Autocomplete returns a very different name (distance > 5)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: ["Abcdefghijklmnop"] }),
    });
    // Word-search strategy also returns nothing (ok: false)
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const result = await fetchCards(["xyz"]);
    expect(Object.keys(result).length).toBe(0);
  });

  it("returns existing card when autocomplete candidate is already in results", async () => {
    // "Bolt" is already resolved in the batch
    mockFetch.mockResolvedValueOnce(
      scryfallResponse([{ name: "Lightning Bolt" }])
    );
    // "Lightnig Bolt" is missing — fuzzy fails
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    // Autocomplete returns "Lightning Bolt" as candidate
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: ["Lightning Bolt"] }),
    });
    // No named lookup needed — already in existing

    const result = await fetchCards(["Lightning Bolt", "Lightnig Bolt"]);
    expect(result["lightning bolt"]).toBeDefined();
    // The misspelled version should resolve to the same card via autocomplete
    expect(result["lightnig bolt"]).toBeDefined();
    expect(result["lightnig bolt"].name).toBe("Lightning Bolt");
  });

  it("handles autocomplete API failure gracefully (no throw)", async () => {
    // Batch fails
    mockFetch.mockResolvedValueOnce(scryfallResponse([]));
    // Fuzzy fails
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    // Autocomplete throws a network error
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    // Word-search: all subsequent calls fail
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    await expect(fetchCards(["Lightnig Bolt"])).resolves.toBeDefined();
  });

  it("resolves via word-search strategy when autocomplete returns no candidates", async () => {
    // Batch fails
    mockFetch.mockResolvedValueOnce(scryfallResponse([]));
    // Fuzzy fails
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    // Autocomplete strategy 1: tries up to 5 prefix lengths, all return empty candidates
    const emptyAutocomplete = { ok: true, json: async () => ({ data: [] }) };
    mockFetch.mockResolvedValueOnce(emptyAutocomplete);
    mockFetch.mockResolvedValueOnce(emptyAutocomplete);
    mockFetch.mockResolvedValueOnce(emptyAutocomplete);
    mockFetch.mockResolvedValueOnce(emptyAutocomplete);
    mockFetch.mockResolvedValueOnce(emptyAutocomplete);
    // Word-search strategy 2: search by last word "Bolt" — returns small set
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ name: "Lightning Bolt" }, { name: "Thunderous Bolt" }],
      }),
    });
    // Named lookup for the best match
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

    const result = await fetchCards(["Lightnig Bolt"]);
    expect(result["lightning bolt"]).toBeDefined();
  });
});
