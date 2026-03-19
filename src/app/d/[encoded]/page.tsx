import type { Metadata } from "next";
import { decodeDeck } from "@/lib/deck-encoder";
import { fetchCardsAction } from "@/lib/scryfall-server";
import { mainboardEntries, sideboardEntries, totalCards } from "@/lib/parser";
import type { ScryfallCard } from "@/lib/scryfall";
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { encoded } = await params;

  try {
    const deck = decodeDeck(encoded);
    const entries = deck.entries;
    const cardCount = totalCards(entries);
    const title = deck.name || "Shared Deck";
    const description = `${cardCount} card deck — view and export on MTG Deck Viewer`;

    // Fetch cards to get an OG image from the first card
    const uniqueCards = new Map<string, { name: string; set?: string }>();
    for (const entry of entries) {
      const key = entry.name.toLowerCase();
      if (!uniqueCards.has(key)) {
        uniqueCards.set(key, { name: entry.name, set: entry.set });
      }
    }

    let ogImage: string | undefined;
    try {
      const cardData = await fetchCardsAction(Array.from(uniqueCards.values()));
      // Use the first mainboard card's art_crop as the OG image
      const main = mainboardEntries(deck);
      for (const entry of main) {
        const key = entry.name.toLowerCase();
        const setKey = entry.set ? `${key}|${entry.set.toLowerCase()}` : undefined;
        const card = (setKey ? cardData[setKey] : undefined) ?? cardData[key];
        if (card) {
          ogImage = getArtCropUrl(card);
          break;
        }
      }
    } catch {
      // If Scryfall fails during metadata generation, skip the OG image
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
