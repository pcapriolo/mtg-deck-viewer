/**
 * Scryfall card types and client-side utility functions.
 *
 * All API fetching has moved to scryfall-server.ts (Server Action) so that
 * both client pages and SSR routes share a single cache and rate limiter.
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
