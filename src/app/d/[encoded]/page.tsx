import type { Metadata } from "next";
import { decodeDeck } from "@/lib/deck-encoder";
import { fetchCardsAction } from "@/lib/scryfall-server";
import { mainboardEntries, sideboardEntries, totalCards } from "@/lib/parser";
import type { ScryfallCard } from "@/lib/scryfall";
import { categorizeCard } from "@/lib/scryfall";
import type { ResolvedEntry } from "@/lib/types";
import SharedDeckView from "./SharedDeckView";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveEntries(
  entries: ReturnType<typeof mainboardEntries>,
  cardData: Record<string, ScryfallCard>
): ResolvedEntry[] {
  const resolved: ResolvedEntry[] = [];
  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    const setKey = entry.set ? `${key}|${entry.set.toLowerCase()}` : undefined;
    const card = (setKey ? cardData[setKey] : undefined) ?? cardData[key];
    if (card) {
      resolved.push({ entry, card });
    }
  }
  return resolved;
}

function getArtCropUrl(card: ScryfallCard): string {
  if (card.image_uris) return card.image_uris.art_crop;
  if (card.card_faces?.[0]?.image_uris) return card.card_faces[0].image_uris.art_crop;
  return "";
}

// ---------------------------------------------------------------------------
// generateMetadata — OG tags for link previews
// ---------------------------------------------------------------------------

interface PageProps {
  params: Promise<{ encoded: string }>;
}

const COLOR_PIP: Record<string, string> = {
  W: "⚪", U: "🔵", B: "⚫", R: "🔴", G: "🟢",
};
const COLOR_ORDER = ["W", "U", "B", "R", "G"];

function colorPips(cards: Record<string, ScryfallCard>): string {
  const colors = new Set<string>();
  for (const card of Object.values(cards)) {
    for (const c of card.color_identity) colors.add(c);
  }
  return COLOR_ORDER.filter((c) => colors.has(c)).map((c) => COLOR_PIP[c]).join("");
}

function selectOgCard(
  cardData: Record<string, ScryfallCard>,
  main: ReturnType<typeof mainboardEntries>,
  deckName?: string
): ScryfallCard | undefined {
  const allCards = Object.values(cardData);

  // 1. Namesake match — deck name matches a card name
  if (deckName) {
    const nameLower = deckName.toLowerCase();
    const namesake = allCards.find((c) =>
      nameLower.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(nameLower)
    );
    if (namesake) return namesake;

    // Word overlap fallback
    const nameWords = nameLower.split(/\s+/).filter((w) => w.length > 2);
    let bestCard: ScryfallCard | undefined;
    let bestOverlap = 0;
    for (const card of allCards) {
      const cardWords = card.name.toLowerCase().split(/\s+/);
      const overlap = nameWords.filter((w) => cardWords.some((cw) => cw.includes(w) || w.includes(cw))).length;
      if (overlap > bestOverlap) { bestOverlap = overlap; bestCard = card; }
    }
    if (bestCard && bestOverlap >= 1) return bestCard;
  }

  // 2. Most expensive card
  const byPrice = allCards
    .filter((c) => c.prices.usd)
    .sort((a, b) => parseFloat(b.prices.usd!) - parseFloat(a.prices.usd!));
  if (byPrice.length > 0) return byPrice[0];

  // 3. First mainboard card
  for (const entry of main) {
    const key = entry.name.toLowerCase();
    const card = cardData[key];
    if (card) return card;
  }

  return allCards[0];
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { encoded } = await params;

  try {
    const deck = decodeDeck(encoded);
    const entries = deck.entries;
    const cardCount = totalCards(entries);
    const title = deck.name || "Shared Deck";

    // Fetch cards to get OG image and stats
    const uniqueCards = new Map<string, { name: string; set?: string }>();
    for (const entry of entries) {
      const key = entry.name.toLowerCase();
      if (!uniqueCards.has(key)) {
        uniqueCards.set(key, { name: entry.name, set: entry.set });
      }
    }

    let ogImage: string | undefined;
    let description = `${cardCount} card deck — view and export on MTG Deck Viewer`;

    try {
      const cardData = await fetchCardsAction(Array.from(uniqueCards.values()));
      const main = mainboardEntries(deck);

      // Select OG image: namesake > expensive > first
      const ogCard = selectOgCard(cardData, main, deck.name);
      if (ogCard) ogImage = getArtCropUrl(ogCard);

      // Build rich description with color pips and type counts
      const pips = colorPips(cardData);
      let creatureCount = 0, spellCount = 0, landCount = 0;
      for (const entry of main) {
        const key = entry.name.toLowerCase();
        const card = cardData[key];
        if (card) {
          const cat = categorizeCard(card);
          if (cat === "Land") landCount += entry.quantity;
          else if (cat === "Creature") creatureCount += entry.quantity;
          else spellCount += entry.quantity;
        }
      }
      const statParts = [
        `${cardCount} cards`,
        ...(pips ? [pips] : []),
        `${creatureCount} creatures, ${spellCount} spells, ${landCount} lands`,
      ];
      description = statParts.join(" · ");
    } catch {
      // If Scryfall fails, use basic description
    }

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        ...(ogImage ? { images: [{ url: ogImage }] } : {}),
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        ...(ogImage ? { images: [ogImage] } : {}),
      },
    };
  } catch {
    return {
      title: "Shared Deck — MTG Deck Viewer",
      description: "View a shared Magic: The Gathering deck.",
    };
  }
}

// ---------------------------------------------------------------------------
// Page component (server)
// ---------------------------------------------------------------------------

export default async function SharedDeckPage({ params }: PageProps) {
  const { encoded } = await params;

  let deck;
  try {
    deck = decodeDeck(encoded);
  } catch {
    return (
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-white mb-2">Deck not found</h1>
        <p className="text-sm text-gray-400 mb-6">
          This link may be invalid or corrupted.
        </p>
        <a
          href="/"
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          Go to MTG Deck Viewer
        </a>
      </main>
    );
  }

  if (deck.entries.length === 0) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-white mb-2">Empty deck</h1>
        <p className="text-sm text-gray-400 mb-6">
          This shared deck contains no cards.
        </p>
        <a
          href="/"
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          Go to MTG Deck Viewer
        </a>
      </main>
    );
  }

  // Fetch card data from Scryfall (let it throw on failure → 500)
  const uniqueCards = new Map<string, { name: string; set?: string }>();
  for (const entry of deck.entries) {
    const key = entry.name.toLowerCase();
    if (!uniqueCards.has(key)) {
      uniqueCards.set(key, { name: entry.name, set: entry.set });
    }
  }

  const cardData = await fetchCardsAction(Array.from(uniqueCards.values()));

  const mainboard = resolveEntries(mainboardEntries(deck), cardData);
  const sideboard = resolveEntries(sideboardEntries(deck), cardData);

  return (
    <SharedDeckView
      mainboard={mainboard}
      sideboard={sideboard}
      deckName={deck.name}
      encoded={encoded}
    />
  );
}
