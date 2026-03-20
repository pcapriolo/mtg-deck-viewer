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

  return results;
}
