/**
 * Lightweight Scryfall batch client for the bot.
 * Mirrors the pattern from src/lib/scryfall-server.ts but runs standalone.
 *
 * No caching (bot is long-lived, low volume) — just batch + rate limit + retry.
 */

export interface BotScryfallCard {
  name: string;
  colors?: string[];
  color_identity: string[];
  type_line: string;
  prices: { usd?: string; usd_foil?: string };
  image_uris?: {
    art_crop: string;
    normal: string;
  };
  card_faces?: Array<{
    name: string;
    image_uris?: { art_crop: string; normal: string };
  }>;
}

let lastRequestTime = 0;

async function enforceRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < 100) {
    await new Promise((r) => setTimeout(r, 100 - elapsed));
  }
  lastRequestTime = Date.now();
}

/**
 * Batch-fetch cards from Scryfall by name.
 * Returns a map of lowercase name → card data.
 */
export async function fetchCards(
  names: string[]
): Promise<Record<string, BotScryfallCard>> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return {};

  const results: Record<string, BotScryfallCard> = {};

  // Batch in groups of 75 (Scryfall limit)
  for (let i = 0; i < unique.length; i += 75) {
    const batch = unique.slice(i, i + 75);
    const body = {
      identifiers: batch.map((name) => ({ name })),
    };

    let response: Response | undefined;
    for (let attempt = 0; attempt <= 3; attempt++) {
      await enforceRateLimit();
      response = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
        continue;
      }
      break;
    }

    if (!response || !response.ok) continue;

    let data: any;
    try {
      data = await response.json();
    } catch {
      continue;
    }

    if (data?.object !== "list" || !Array.isArray(data.data)) continue;

    for (const card of data.data as BotScryfallCard[]) {
      const key = card.name.toLowerCase();
      results[key] = card;

      // Also index by each face for split/DFC cards
      if (card.name.includes(" // ")) {
        for (const face of card.name.split(" // ")) {
          const faceKey = face.trim().toLowerCase();
          if (!results[faceKey]) results[faceKey] = card;
        }
      }
    }
  }

  // Fuzzy fallback: for any requested name not found, try Scryfall fuzzy search
  const missing = unique.filter((n) => !results[n.toLowerCase()]);
  for (const name of missing) {
    await enforceRateLimit();
    try {
      const resp = await fetch(
        `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`,
      );
      if (resp.ok) {
        const card = (await resp.json()) as BotScryfallCard;
        indexCard(results, card, name);
      }
    } catch {
      // Fuzzy search failed — skip this card
    }
  }

  // Autocomplete fallback: for cards still missing after fuzzy, try progressively
  // shorter prefixes with Scryfall autocomplete + Levenshtein distance matching.
  // Catches OCR typos that fuzzy search can't resolve (e.g. "Floodflare" → "Floodfarm").
  const stillMissing = unique.filter((n) => !results[n.toLowerCase()]);
  for (const name of stillMissing) {
    const card = await autocompleteResolve(name, results);
    if (card) {
      indexCard(results, card, name);
    }
  }

  return results;
}

/**
 * Index a resolved card in the results map by canonical name, original name,
 * and split/DFC face names.
 */
function indexCard(
  results: Record<string, BotScryfallCard>,
  card: BotScryfallCard,
  originalName: string
): void {
  const key = card.name.toLowerCase();
  results[key] = card;
  // Also index by the original (possibly misspelled) name so callers can find it
  results[originalName.toLowerCase()] = card;
  if (card.name.toLowerCase() !== originalName.toLowerCase()) {
    console.log(`   🔤 Fuzzy fix: "${originalName}" → "${card.name}"`);
  }
  if (card.name.includes(" // ")) {
    for (const face of card.name.split(" // ")) {
      const faceKey = face.trim().toLowerCase();
      if (!results[faceKey]) results[faceKey] = card;
    }
  }
}

/**
 * Levenshtein edit distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Try to resolve a misspelled card name via two strategies:
 *   1. Autocomplete with progressively shorter first-word prefixes
 *   2. Scryfall search with individual words from the name
 * Picks the closest match by Levenshtein distance (max 5).
 */
async function autocompleteResolve(
  name: string,
  existing: Record<string, BotScryfallCard>
): Promise<BotScryfallCard | null> {
  const nameLower = name.toLowerCase();

  // Strategy 1: Autocomplete with progressively shorter first-word prefixes
  const firstWord = name.split(/\s+/)[0];
  if (firstWord && firstWord.length >= 3) {
    const MAX_ATTEMPTS = 5;
    let attempts = 0;
    for (let len = firstWord.length; len >= 3 && attempts < MAX_ATTEMPTS; len--, attempts++) {
      const prefix = firstWord.slice(0, len);
      const card = await tryAutocompleteCandidates(prefix, nameLower, existing);
      if (card) return card;
    }
  }

  // Strategy 2: Scryfall search using individual words (catches middle-of-word typos)
  // e.g. "Stirring Town" → search "name:Town" → finds "Starting Town" (dist 3)
  const words = name.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length >= 2) {
    // Try each word as a search term, starting from the last (more specific)
    for (let i = words.length - 1; i >= 0; i--) {
      const word = words[i];
      await enforceRateLimit();
      try {
        const query = encodeURIComponent(`name:${word}`);
        const resp = await fetch(
          `https://api.scryfall.com/cards/search?q=${query}&unique=cards&order=name`,
        );
        if (!resp.ok) continue;

        const data = (await resp.json()) as { data?: Array<{ name: string }> };
        const candidates = (data.data ?? []).map((c) => c.name);
        if (candidates.length === 0 || candidates.length > 50) continue;

        let bestMatch: string | null = null;
        let bestDist = Infinity;
        for (const candidate of candidates) {
          const dist = levenshtein(nameLower, candidate.toLowerCase());
          if (dist < bestDist) {
            bestDist = dist;
            bestMatch = candidate;
          }
        }

        if (!bestMatch || bestDist > 5) continue;

        if (existing[bestMatch.toLowerCase()]) {
          return existing[bestMatch.toLowerCase()];
        }

        await enforceRateLimit();
        const cardResp = await fetch(
          `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(bestMatch)}`,
        );
        if (cardResp.ok) {
          const card = (await cardResp.json()) as BotScryfallCard;
          console.log(`   🔍 Search fix: "${name}" → "${card.name}" (distance: ${bestDist})`);
          return card;
        }
      } catch {
        // Search failed — try next word
      }
    }
  }

  return null;
}

/**
 * Try autocomplete with a prefix, pick the closest candidate by Levenshtein.
 */
async function tryAutocompleteCandidates(
  prefix: string,
  nameLower: string,
  existing: Record<string, BotScryfallCard>
): Promise<BotScryfallCard | null> {
  await enforceRateLimit();
  try {
    const resp = await fetch(
      `https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(prefix)}`,
    );
    if (!resp.ok) return null;

    const data = (await resp.json()) as { data?: string[] };
    const candidates = data.data ?? [];
    if (candidates.length === 0) return null;

    let bestMatch: string | null = null;
    let bestDist = Infinity;
    for (const candidate of candidates) {
      const dist = levenshtein(nameLower, candidate.toLowerCase());
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = candidate;
      }
    }

    if (!bestMatch || bestDist > 5) return null;

    if (existing[bestMatch.toLowerCase()]) {
      return existing[bestMatch.toLowerCase()];
    }

    await enforceRateLimit();
    const cardResp = await fetch(
      `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(bestMatch)}`,
    );
    if (cardResp.ok) {
      const card = (await cardResp.json()) as BotScryfallCard;
      console.log(`   🔍 Autocomplete fix: "${nameLower}" → "${card.name}" (distance: ${bestDist})`);
      return card;
    }
  } catch {
    // Autocomplete attempt failed
  }
  return null;
}
