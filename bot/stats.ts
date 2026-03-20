/**
 * Deck stats derivation — color identity, type counts, namesake card selection.
 *
 * Color pip mapping:
 *   W → ⚪  U → 🔵  B → ⚫  R → 🔴  G → 🟢
 */

import type { BotScryfallCard } from "./scryfall";

export interface DeckStats {
  colors: string[];
  colorPips: string;
  creatureCount: number;
  spellCount: number;
  landCount: number;
  mainCount: number;
  sideCount: number;
  topCard?: BotScryfallCard;
}

const COLOR_ORDER = ["W", "U", "B", "R", "G"];

const PIP_MAP: Record<string, string> = {
  W: "⚪",
  U: "🔵",
  B: "⚫",
  R: "🔴",
  G: "🟢",
};

export function colorsToPips(colors: string[]): string {
  return COLOR_ORDER.filter((c) => colors.includes(c))
    .map((c) => PIP_MAP[c])
    .join("");
}

/**
 * Derive deck stats from Scryfall card data and the raw decklist text.
 */
export function deriveDeckStats(
  cards: Record<string, BotScryfallCard>,
  deckText: string,
  deckName?: string,
  hallmarkCardName?: string | null
): DeckStats {
  const lines = deckText.split("\n");
  const colorSet = new Set<string>();
  let creatureCount = 0;
  let spellCount = 0;
  let landCount = 0;
  let mainCount = 0;
  let sideCount = 0;
  let inSideboard = false;

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (!trimmed) continue;
    if (/^(name|author)[:\s]/i.test(trimmed)) continue;
    if (/^sideboard$/i.test(trimmed) || /^side$/i.test(trimmed)) {
      inSideboard = true;
      continue;
    }

    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;

    const qty = parseInt(match[1]);
    const cardName = match[2].trim();

    if (inSideboard) {
      sideCount += qty;
    } else {
      mainCount += qty;
    }

    const card = cards[cardName.toLowerCase()];
    if (card) {
      // Accumulate colors from color_identity
      for (const c of card.color_identity) colorSet.add(c);

      // Count by type (mainboard only)
      if (!inSideboard) {
        const type = card.type_line.toLowerCase();
        if (type.includes("land")) landCount += qty;
        else if (type.includes("creature")) creatureCount += qty;
        else spellCount += qty;
      }
    }
  }

  const colors = COLOR_ORDER.filter((c) => colorSet.has(c));

  // Use hallmark card from reconciliation if available
  let topCard: BotScryfallCard | undefined;
  if (hallmarkCardName) {
    topCard = cards[hallmarkCardName.toLowerCase()];
  }
  if (!topCard) {
    topCard = selectTopCard(cards, deckText, deckName);
  }

  return {
    colors,
    colorPips: colorsToPips(colors),
    creatureCount,
    spellCount,
    landCount,
    mainCount,
    sideCount,
    topCard,
  };
}

/**
 * Select the "star" card for OG preview image.
 * Priority: namesake match → most expensive → first mainboard card.
 */
export function selectTopCard(
  cards: Record<string, BotScryfallCard>,
  deckText: string,
  deckName?: string
): BotScryfallCard | undefined {
  const allCards = Object.values(cards);
  if (allCards.length === 0) return undefined;

  // 1. If deck name exists, fuzzy-match against card names
  if (deckName) {
    const nameLower = deckName.toLowerCase();
    // Try exact substring match first
    const exactMatch = allCards.find((c) =>
      nameLower.includes(c.name.toLowerCase()) ||
      c.name.toLowerCase().includes(nameLower)
    );
    if (exactMatch) return exactMatch;

    // Try word overlap — find the card with the most words in common
    const nameWords = nameLower.split(/\s+/).filter((w) => w.length > 2);
    let bestCard: BotScryfallCard | undefined;
    let bestOverlap = 0;
    for (const card of allCards) {
      const cardWords = card.name.toLowerCase().split(/\s+/);
      const overlap = nameWords.filter((w) => cardWords.some((cw) => cw.includes(w) || w.includes(cw))).length;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestCard = card;
      }
    }
    if (bestCard && bestOverlap >= 1) return bestCard;
  }

  // 2. Most expensive card
  const byPrice = allCards
    .filter((c) => c.prices.usd)
    .sort((a, b) => parseFloat(b.prices.usd!) - parseFloat(a.prices.usd!));
  if (byPrice.length > 0) return byPrice[0];

  // 3. First card in the decklist
  const lines = deckText.split("\n");
  for (const line of lines) {
    const match = line.match(/^\d+\s+(.+)$/);
    if (match) {
      const card = cards[match[1].trim().toLowerCase()];
      if (card) return card;
    }
  }

  return allCards[0];
}

/**
 * Get art_crop URL from a card (handles DFC/split cards).
 */
export function getArtCrop(card: BotScryfallCard): string {
  if (card.image_uris?.art_crop) return card.image_uris.art_crop;
  if (card.card_faces?.[0]?.image_uris?.art_crop) return card.card_faces[0].image_uris.art_crop;
  return "";
}
