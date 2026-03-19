/**
 * Scryfall API client with in-memory caching.
 *
 * Uses the /cards/collection endpoint for batch lookups (up to 75 cards per request).
 * This is far more efficient than individual card lookups for full decklists.
 */

export interface ScryfallCard {
  id: string;
  name: string;
  mana_cost: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  color_identity: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  rarity: string;
  set: string;
  set_name: string;
  collector_number: string;
  image_uris?: {
    small: string;
    normal: string;
    large: string;
    png: string;
    art_crop: string;
    border_crop: string;
  };
  card_faces?: Array<{
    name: string;
    mana_cost: string;
    type_line: string;
    oracle_text?: string;
    image_uris?: {
      small: string;
      normal: string;
      large: string;
      png: string;
      art_crop: string;
      border_crop: string;
    };
  }>;
  prices: {
    usd?: string;
    usd_foil?: string;
  };
  legalities: Record<string, string>;
  keywords: string[];
}

const cache = new Map<string, ScryfallCard>();

function cacheKey(name: string, set?: string): string {
  const key = name.toLowerCase();
  return set ? `${key}|${set.toLowerCase()}` : key;
}

/**
 * Fetch cards from Scryfall using the /cards/collection endpoint.
 * Batches up to 75 identifiers per request (Scryfall's limit).
 */
export async function fetchCards(
  identifiers: Array<{ name: string; set?: string }>
): Promise<Map<string, ScryfallCard>> {
  const results = new Map<string, ScryfallCard>();
  const uncached: Array<{ name: string; set?: string }> = [];

  // Check cache first
  for (const id of identifiers) {
    const key = cacheKey(id.name, id.set);
    const cached = cache.get(key);
    if (cached) {
      results.set(key, cached);
    } else {
      uncached.push(id);
    }
  }

  if (uncached.length === 0) return results;

  // Batch into groups of 75
  const batches: Array<typeof uncached> = [];
  for (let i = 0; i < uncached.length; i += 75) {
    batches.push(uncached.slice(i, i + 75));
  }

  for (const batch of batches) {
    const body = {
      identifiers: batch.map((id) =>
        id.set ? { name: id.name, set: id.set } : { name: id.name }
      ),
    };

    const response = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Scryfall API error: ${response.status}`);
    }

    const data = await response.json();

    for (const card of data.data as ScryfallCard[]) {
      const key = cacheKey(card.name);
      cache.set(key, card);
      results.set(key, card);

      // Also cache with set for specific lookups
      const setKey = cacheKey(card.name, card.set);
      cache.set(setKey, card);
      results.set(setKey, card);
    }

    // Respect rate limit between batches
    if (batches.length > 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return results;
}

/**
 * Get the best image URI for a card.
 * Handles double-faced cards by returning the front face.
 */
export function cardImageUri(
  card: ScryfallCard,
  size: "small" | "normal" | "large" = "normal"
): string {
  if (card.image_uris) {
    return card.image_uris[size];
  }
  // Double-faced card — use front face
  if (card.card_faces?.[0]?.image_uris) {
    return card.card_faces[0].image_uris[size];
  }
  return "";
}

/**
 * Categorize a card by its primary type for deck grouping.
 */
export type CardCategory =
  | "Creature"
  | "Planeswalker"
  | "Instant"
  | "Sorcery"
  | "Enchantment"
  | "Artifact"
  | "Land"
  | "Other";

const CATEGORY_ORDER: CardCategory[] = [
  "Creature",
  "Planeswalker",
  "Instant",
  "Sorcery",
  "Enchantment",
  "Artifact",
  "Land",
  "Other",
];

export function categorizeCard(card: ScryfallCard): CardCategory {
  const type = card.type_line.toLowerCase();
  if (type.includes("creature")) return "Creature";
  if (type.includes("planeswalker")) return "Planeswalker";
  if (type.includes("instant")) return "Instant";
  if (type.includes("sorcery")) return "Sorcery";
  if (type.includes("enchantment")) return "Enchantment";
  if (type.includes("artifact")) return "Artifact";
  if (type.includes("land")) return "Land";
  return "Other";
}

export function categoryOrder(category: CardCategory): number {
  return CATEGORY_ORDER.indexOf(category);
}

/**
 * Map a color letter to its display info.
 */
export const COLOR_MAP: Record<string, { name: string; hex: string }> = {
  W: { name: "White", hex: "#F9FAF4" },
  U: { name: "Blue", hex: "#0E68AB" },
  B: { name: "Black", hex: "#150B00" },
  R: { name: "Red", hex: "#D3202A" },
  G: { name: "Green", hex: "#00733E" },
};
