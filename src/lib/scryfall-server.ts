"use server";

/**
 * Scryfall Server Action — centralises all Scryfall API calls behind a
 * Next.js Server Action so both the client page and the SSR /d/ route
 * share one cache and one rate-limiter.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │                      fetchCardsAction()                         │
 * │                                                                  │
 * │  identifiers ──► split cached / uncached                        │
 * │                      │                                           │
 * │          ┌───────────┴───────────┐                              │
 * │          │ cached hits           │ uncached misses              │
 * │          │ (LRU Map, 24h TTL)   │                              │
 * │          │ ──► merge into result │                              │
 * │          └───────────────────────┘                              │
 * │                                   │                              │
 * │                      batch into groups of 75                    │
 * │                                   │                              │
 * │                      for each batch:                            │
 * │                        ├─ wait for global rate-limit (100ms)    │
 * │                        ├─ POST /cards/collection                │
 * │                        ├─ on 429 ──► retry w/ exp backoff      │
 * │                        │   (200ms → 400ms → 800ms, max 3)      │
 * │                        ├─ on 5xx ──► throw "temporarily        │
 * │                        │              unavailable"              │
 * │                        ├─ parse JSON (catch HTML error pages)   │
 * │                        ├─ validate data.object === "list"       │
 * │                        └─ populate cache + results              │
 * │                                                                  │
 * │  return Record<string, ScryfallCard>  (plain serialisable obj) │
 * └──────────────────────────────────────────────────────────────────┘
 */

import type { ScryfallCard } from "./scryfall";

// ---------------------------------------------------------------------------
// LRU Cache (Map-based, max 2000 entries, 24-hour TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  card: ScryfallCard;
  timestamp: number;
}

const MAX_CACHE_SIZE = 2000;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const lruCache = new Map<string, CacheEntry>();

function cacheGet(key: string): ScryfallCard | undefined {
  const entry = lruCache.get(key);
  if (!entry) return undefined;

  // Evict if expired
  if (Date.now() - entry.timestamp > TTL_MS) {
    lruCache.delete(key);
    return undefined;
  }

  // Move to end (most-recently-used) by re-inserting
  lruCache.delete(key);
  lruCache.set(key, entry);
  return entry.card;
}

function cacheSet(key: string, card: ScryfallCard): void {
  // If key already exists, delete first so re-insert moves it to the end
  if (lruCache.has(key)) {
    lruCache.delete(key);
  }

  // Evict oldest entries if at capacity
  while (lruCache.size >= MAX_CACHE_SIZE) {
    const oldest = lruCache.keys().next().value;
    if (oldest !== undefined) {
      lruCache.delete(oldest);
    }
  }

  lruCache.set(key, { card, timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Cache key helpers
// ---------------------------------------------------------------------------

function cacheKey(name: string, set?: string): string {
  const key = name.toLowerCase();
  return set ? `${key}|${set.toLowerCase()}` : key;
}

// ---------------------------------------------------------------------------
// Global rate limiter — enforces >= 100ms between Scryfall API calls
// ---------------------------------------------------------------------------

let lastRequestTime = 0;

async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 100) {
    await new Promise((r) => setTimeout(r, 100 - elapsed));
  }
  lastRequestTime = Date.now();
}

// ---------------------------------------------------------------------------
// Retry helper with exponential backoff for 429 responses
//
//   attempt 0 ──► 200ms wait
//   attempt 1 ──► 400ms wait
//   attempt 2 ──► 800ms wait
//   attempt 3 ──► give up
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 200;

async function fetchWithRetry(
  url: string,
  init: RequestInit
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await enforceRateLimit();

    const response = await fetch(url, init);

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    return response;
  }

  // Unreachable, but satisfies TypeScript
  throw new Error("Scryfall request failed after maximum retries");
}

// ---------------------------------------------------------------------------
// Main Server Action
// ---------------------------------------------------------------------------

export async function fetchCardsAction(
  identifiers: Array<{ name: string; set?: string }>
): Promise<Record<string, ScryfallCard>> {
  const results: Record<string, ScryfallCard> = {};
  const uncached: Array<{ name: string; set?: string }> = [];

  // 1. Check cache first
  for (const id of identifiers) {
    const key = cacheKey(id.name, id.set);
    const cached = cacheGet(key);
    if (cached) {
      results[key] = cached;
    } else {
      uncached.push(id);
    }
  }

  if (uncached.length === 0) return results;

  // 2. Batch uncached identifiers into groups of 75
  const batches: Array<typeof uncached> = [];
  for (let i = 0; i < uncached.length; i += 75) {
    batches.push(uncached.slice(i, i + 75));
  }

  // 3. Fetch each batch
  for (const batch of batches) {
    const body = {
      identifiers: batch.map((id) =>
        id.set ? { name: id.name, set: id.set } : { name: id.name }
      ),
    };

    const response = await fetchWithRetry(
      "https://api.scryfall.com/cards/collection",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    // Handle 5xx server errors
    if (response.status >= 500) {
      throw new Error("Scryfall is temporarily unavailable");
    }

    if (!response.ok) {
      throw new Error(`Scryfall API error: ${response.status}`);
    }

    // Parse JSON safely — Scryfall can sometimes return HTML error pages
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        "Scryfall returned an invalid response (expected JSON, got HTML or malformed data)"
      );
    }

    // Validate the response shape before iterating
    if (
      typeof data !== "object" ||
      data === null ||
      (data as Record<string, unknown>).object !== "list" ||
      !Array.isArray((data as Record<string, unknown>).data)
    ) {
      throw new Error(
        "Scryfall returned an unexpected response format (expected a list)"
      );
    }

    const cards = (data as { data: ScryfallCard[] }).data;

    for (const card of cards) {
      // Cache by full name
      const nameKey = cacheKey(card.name);
      cacheSet(nameKey, card);
      results[nameKey] = card;

      // Cache with set for specific lookups
      const setKey = cacheKey(card.name, card.set);
      cacheSet(setKey, card);
      results[setKey] = card;

      // For double-faced / split cards (name contains " // "),
      // also cache by each face name so "Esper Origins" finds
      // "Esper Origins // Summon: Esper Maduin"
      if (card.name.includes(" // ")) {
        for (const faceName of card.name.split(" // ")) {
          const faceKey = cacheKey(faceName.trim());
          if (!results[faceKey]) {
            cacheSet(faceKey, card);
            results[faceKey] = card;
          }
        }
      }
    }
  }

  // Fuzzy fallback: for any requested name not found, try Scryfall fuzzy search
  const missing = uncached.filter((id) => {
    const key = cacheKey(id.name, id.set);
    const nameOnly = cacheKey(id.name);
    return !results[key] && !results[nameOnly];
  });

  for (const id of missing) {
    await enforceRateLimit();
    try {
      const resp = await fetch(
        `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(id.name)}`,
      );
      if (resp.ok) {
        const card = (await resp.json()) as ScryfallCard;
        const nameKey = cacheKey(card.name);
        cacheSet(nameKey, card);
        results[nameKey] = card;
        // Also index by the original (possibly misspelled) name
        const origKey = cacheKey(id.name);
        if (origKey !== nameKey) {
          cacheSet(origKey, card);
          results[origKey] = card;
        }
      }
    } catch {
      // Fuzzy search failed — skip
    }
  }

  return results;
}
