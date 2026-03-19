"use client";

import { useState, useCallback } from "react";
import { parseDeckList, mainboardEntries, sideboardEntries, DeckEntry } from "@/lib/parser";
import { fetchCards, ScryfallCard } from "@/lib/scryfall";
import { encodeDeck } from "@/lib/deck-encoder";
import DeckInput from "@/components/DeckInput";
import DeckViewer from "@/components/DeckViewer";

interface ResolvedEntry {
  entry: DeckEntry;
  card: ScryfallCard;
}

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mainboard, setMainboard] = useState<ResolvedEntry[]>([]);
  const [sideboard, setSideboard] = useState<ResolvedEntry[]>([]);
  const [deckName, setDeckName] = useState<string | undefined>();
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const handleSubmit = useCallback(async (input: string, type: "text" | "image") => {
    setLoading(true);
    setError(null);
    setMainboard([]);
    setSideboard([]);
    setShareUrl(null);

    try {
      let deckText = input;

      // If image, we'd OCR it here. For MVP, show a message.
      if (type === "image") {
        setError("Image parsing coming soon. Paste a text decklist for now.");
        setLoading(false);
        return;
      }

      const deck = parseDeckList(deckText);
      if (deck.entries.length === 0) {
        setError("No cards found. Check your decklist format.");
        setLoading(false);
        return;
      }

      setDeckName(deck.name);

      // Fetch all unique cards from Scryfall
      const uniqueCards = new Map<string, { name: string; set?: string }>();
      for (const entry of deck.entries) {
        const key = entry.name.toLowerCase();
        if (!uniqueCards.has(key)) {
          uniqueCards.set(key, { name: entry.name, set: entry.set });
        }
      }

      const cardData = await fetchCards(Array.from(uniqueCards.values()));

      // Resolve entries to cards
      const resolveEntries = (entries: typeof deck.entries): ResolvedEntry[] => {
        const resolved: ResolvedEntry[] = [];
        for (const entry of entries) {
          const key = entry.name.toLowerCase();
          const card = cardData.get(key) ?? cardData.get(`${key}|${entry.set?.toLowerCase()}`);
          if (card) {
            resolved.push({ entry, card });
          }
        }
        return resolved;
      };

      const main = resolveEntries(mainboardEntries(deck));
      const side = resolveEntries(sideboardEntries(deck));

      if (main.length === 0 && side.length === 0) {
        setError("Could not find any cards on Scryfall. Check spelling.");
        setLoading(false);
        return;
      }

      setMainboard(main);
      setSideboard(side);

      // Generate share URL
      const encoded = encodeDeck(deck);
      const url = `${window.location.origin}/d/${encoded}`;
      setShareUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, []);

  const hasResults = mainboard.length > 0 || sideboard.length > 0;

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-white mb-1">MTG Deck Viewer</h1>
        <p className="text-sm text-gray-500">
          Paste a decklist. Hover to inspect cards. Share anywhere.
        </p>
      </div>

      {/* Input (hide when viewing results) */}
      {!hasResults && <DeckInput onSubmit={handleSubmit} loading={loading} />}

      {/* Error */}
      {error && (
        <div className="mt-4 p-3 bg-red-900/20 border border-red-800/40 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Results */}
      {hasResults && (
        <div className="space-y-6">
          {/* Share bar */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setMainboard([]);
                setSideboard([]);
                setShareUrl(null);
                setDeckName(undefined);
              }}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              ← New deck
            </button>

            {shareUrl && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                }}
                className="ml-auto text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded transition-colors"
              >
                Copy share link
              </button>
            )}
          </div>

          {/* Mainboard */}
          <DeckViewer entries={mainboard} deckName={deckName} section="Mainboard" />

          {/* Sideboard */}
          {sideboard.length > 0 && (
            <div className="border-t border-gray-800 pt-4">
              <DeckViewer entries={sideboard} section="Sideboard" />
            </div>
          )}
        </div>
      )}
    </main>
  );
}
