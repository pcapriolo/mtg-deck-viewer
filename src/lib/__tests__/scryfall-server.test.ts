import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// scryfall-server.ts uses the global `fetch` and internal setTimeout-based
// rate limiting. We stub global fetch and use fake timers so tests run fast.
// The module has global LRU cache state — unique card names prevent cross-test
// cache hits.

function makeScryfallCard(name: string, set = "tst"): Record<string, unknown> {
  return {
    object: "card",
    id: `id-${name}`,
    name,
    mana_cost: "{1}",
    cmc: 1,
    type_line: "Instant",
    color_identity: [],
    rarity: "common",
    set,
    set_name: "Test Set",
    collector_number: "1",
    image_uris: { normal: `https://img/${name}.jpg` },
    prices: {},
    legalities: {},
    keywords: [],
  };
}

function makeScryfallListResponse(
  cards: Record<string, unknown>[]
): Record<string, unknown> {
  return { object: "list", data: cards };
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Run a fetchCardsAction call while concurrently advancing fake timers so
// setTimeout-based rate limiting and retry backoffs resolve correctly.
// We attach a no-op .catch() to prevent unhandled rejection warnings while
// timers are advancing; the real error is still caught by the caller.
async function run(
  action: () => Promise<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  const promise = action();
  // Prevent Node from reporting an unhandled rejection while timers are pending
  promise.catch(() => undefined);
  await vi.runAllTimersAsync();
  return promise;
}

describe("fetchCardsAction", () => {
  let fetchCardsAction: (
    ids: Array<{ name: string; set?: string }>
  ) => Promise<Record<string, unknown>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    ({ fetchCardsAction } = await import("@/lib/scryfall-server"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns empty object when given zero identifiers", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchCardsAction([]);
    expect(result).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches from Scryfall when card is not in cache", async () => {
    const card = makeScryfallCard("Fetch Test Card Aa1");
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeJsonResponse(makeScryfallListResponse([card])));
    vi.stubGlobal("fetch", mockFetch);

    const result = await run(() =>
      fetchCardsAction([{ name: "Fetch Test Card Aa1" }])
    );
    expect(result["fetch test card aa1"]).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toBe("https://api.scryfall.com/cards/collection");
  });

  it("returns cached card on second call without additional fetch", async () => {
    const card = makeScryfallCard("Cached Card Bb2");
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeJsonResponse(makeScryfallListResponse([card])));
    vi.stubGlobal("fetch", mockFetch);

    // First call — fetches from Scryfall
    await run(() => fetchCardsAction([{ name: "Cached Card Bb2" }]));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call — served from LRU cache
    vi.clearAllMocks();
    const mockFetch2 = vi.fn();
    vi.stubGlobal("fetch", mockFetch2);
    const r2 = await run(() => fetchCardsAction([{ name: "Cached Card Bb2" }]));
    expect(r2["cached card bb2"]).toBeDefined();
    expect(mockFetch2).not.toHaveBeenCalled();
  });

  it("caches both name-only key and name+set key for a returned card", async () => {
    const card = makeScryfallCard("Dual Key Card Cc3", "mh3");
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeJsonResponse(makeScryfallListResponse([card])));
    vi.stubGlobal("fetch", mockFetch);

    const result = await run(() =>
      fetchCardsAction([{ name: "Dual Key Card Cc3", set: "mh3" }])
    );
    expect(result["dual key card cc3"]).toBeDefined();
    expect(result["dual key card cc3|mh3"]).toBeDefined();
  });

  it("caches double-faced card by each face name", async () => {
    const card = makeScryfallCard("Front Face Dd4 // Back Face Dd4", "tst");
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeJsonResponse(makeScryfallListResponse([card])));
    vi.stubGlobal("fetch", mockFetch);

    const result = await run(() =>
      fetchCardsAction([{ name: "Front Face Dd4 // Back Face Dd4" }])
    );
    expect(result["front face dd4"]).toBeDefined();
    expect(result["back face dd4"]).toBeDefined();
    expect(result["front face dd4 // back face dd4"]).toBeDefined();
  });

  it("retries on 429 and succeeds on subsequent attempt", async () => {
    const card = makeScryfallCard("Retry Card Ee5");
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValue(makeJsonResponse(makeScryfallListResponse([card])));
    vi.stubGlobal("fetch", mockFetch);

    const result = await run(() =>
      fetchCardsAction([{ name: "Retry Card Ee5" }])
    );
    expect(result["retry card ee5"]).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws 'temporarily unavailable' on 5xx response", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      run(() => fetchCardsAction([{ name: "Server Error Card Ff6" }]))
    ).rejects.toThrow("temporarily unavailable");
  });

  it("throws on non-5xx non-ok response (e.g. 400)", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "bad" }), { status: 400 })
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      run(() => fetchCardsAction([{ name: "Bad Request Card Gg7" }]))
    ).rejects.toThrow("Scryfall API error: 400");
  });

  it("throws when Scryfall returns non-JSON (HTML error page)", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response("<html>Error</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      run(() => fetchCardsAction([{ name: "Html Error Card Hh8" }]))
    ).rejects.toThrow("invalid response");
  });

  it("throws when Scryfall response is not a list object", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeJsonResponse({ object: "card", name: "Wrong" }));
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      run(() => fetchCardsAction([{ name: "Wrong Format Card Ii9" }]))
    ).rejects.toThrow("unexpected response format");
  });

  it("falls back to fuzzy search for cards not resolved in batch", async () => {
    const fuzzyCard = makeScryfallCard("Lightning Bolt", "2ed");

    const mockFetch = vi
      .fn()
      // Batch returns empty list (card not found)
      .mockResolvedValueOnce(makeJsonResponse(makeScryfallListResponse([])))
      // Fuzzy endpoint returns the card
      .mockResolvedValue(makeJsonResponse(fuzzyCard));
    vi.stubGlobal("fetch", mockFetch);

    const result = await run(() =>
      fetchCardsAction([{ name: "Lightnig Bolt Jj10" }]) // intentional typo
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const fuzzyUrl = mockFetch.mock.calls[1][0] as string;
    expect(fuzzyUrl).toContain("named?fuzzy=");
    // Indexed by canonical name returned from Scryfall
    expect(result["lightning bolt"]).toBeDefined();
  });

  it("skips fuzzy search gracefully when it throws a network error", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(makeScryfallListResponse([])))
      .mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", mockFetch);

    // Should not throw
    const result = await run(() =>
      fetchCardsAction([{ name: "Nonexistent Kk11 Card" }])
    );
    expect(result).toBeDefined();
  });

  it("batches more than 75 cards into two requests", async () => {
    const cards76 = Array.from({ length: 76 }, (_, i) =>
      makeScryfallCard(`Batch Ll12 Card ${String(i).padStart(3, "0")}`)
    );

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse(makeScryfallListResponse(cards76.slice(0, 75)))
      )
      .mockResolvedValue(
        makeJsonResponse(makeScryfallListResponse(cards76.slice(75)))
      );
    vi.stubGlobal("fetch", mockFetch);

    const identifiers = cards76.map((c) => ({ name: c.name as string }));
    const result = await run(() => fetchCardsAction(identifiers));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(Object.keys(result).length).toBeGreaterThan(75);
  });
});
