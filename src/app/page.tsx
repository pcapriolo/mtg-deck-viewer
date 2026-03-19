"use client";

import { useState, useCallback, useEffect } from "react";
import { parseDeckList, mainboardEntries, sideboardEntries } from "@/lib/parser";
import { fetchCardsAction } from "@/lib/scryfall-server";
import { encodeDeck } from "@/lib/deck-encoder";
import { ResolvedEntry } from "@/lib/types";
import DeckInput from "@/components/DeckInput";
import DeckViewer from "@/components/DeckViewer";
import PriceTotal from "@/components/PriceTotal";
import LegalityBadges from "@/components/LegalityBadges";
import ExportButtons from "@/components/ExportButtons";

const MAX_INPUT_LENGTH = 10_000;

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [mainboard, setMainboard] = useState<ResolvedEntry[]>([]);
  const [sideboard, setSideboard] = useState<ResolvedEntry[]>([]);
  const [deckName, setDeckName] = useState<string | undefined>();
  const [deckAuthor, setDeckAuthor] = useState<string | undefined>();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const resetToInput = useCallback(() => {
    setMainboard([]);
    setSideboard([]);
    setShareUrl(null);
    setDeckName(undefined);
    setDeckAuthor(undefined);
    setWarning(null);
    setError(null);
  }, []);

  // Browser back button returns to input view
  useEffect(() => {
    const onPopState = () => {
      resetToInput();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [resetToInput]);

  const handleSubmit = useCallback(async (input: string, type: "text" | "image") => {
    setLoading(true);
    setError(null);
    setWarning(null);
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

      // Input length validation
      if (deckText.length > MAX_INPUT_LENGTH) {
        setError("Decklist is too long (max 10,000 characters)");
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
      setDeckAuthor(deck.author);

      // Fetch all unique cards from Scryfall
      const uniqueCards = new Map<string, { name: string; set?: string }>();
      for (const entry of deck.entries) {
        const key = entry.name.toLowerCase();
        if (!uniqueCards.has(key)) {
          uniqueCards.set(key, { name: entry.name, set: entry.set });
        }
      }

      const cardData = await fetchCardsAction(Array.from(uniqueCards.values()));

      // Resolve entries to cards
      const resolveEntries = (entries: typeof deck.entries): ResolvedEntry[] => {
        const resolved: ResolvedEntry[] = [];
        for (const entry of entries) {
          const key = entry.name.toLowerCase();
          const card = cardData[key] ?? cardData[`${key}|${entry.set?.toLowerCase()}`];
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

      // "Not found" warning
      const allParsed = deck.entries;
      const resolvedCount = main.length + side.length;
      if (resolvedCount < allParsed.length) {
        const resolvedNames = new Set([
          ...main.map((r) => r.entry.name.toLowerCase()),
          ...side.map((r) => r.entry.name.toLowerCase()),
        ]);
        const notFound = allParsed
          .filter((e) => !resolvedNames.has(e.name.toLowerCase()))
          .map((e) => e.name);
        // Deduplicate
        const uniqueNotFound = Array.from(new Set(notFound));
        const display = uniqueNotFound.slice(0, 10);
        const suffix =
          uniqueNotFound.length > 10
            ? ` and ${uniqueNotFound.length - 10} more`
            : "";
        setWarning(
          `${uniqueNotFound.length} card${uniqueNotFound.length === 1 ? "" : "s"} not found: ${display.join(", ")}${suffix}`
        );
      }

      setMainboard(main);
      setSideboard(side);

      // Generate share URL
      const encoded = encodeDeck(deck);
      const url = `${window.location.origin}/d/${encoded}`;
      setShareUrl(url);

      // Push history state so browser back returns to input
      window.history.pushState({ view: "results" }, "", window.location.pathname);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, []);

  const hasResults = mainboard.length > 0 || sideboard.length > 0;

  return (
    <main className={`mx-auto px-4 py-8 ${hasResults ? "max-w-7xl" : "max-w-2xl"}`}>
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

      {/* Warning (cards not found) */}
      {warning && (
        <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-800/40 rounded-lg text-sm text-yellow-300">
          {warning}
        </div>
      )}

      {/* Results */}
      {hasResults && (
        <div className="space-y-6">
          {/* Share bar */}
          <div className="flex items-center gap-2">
            <button
              onClick={resetToInput}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              &larr; New deck
            </button>

            <div className="ml-auto flex items-center gap-2">
              <ExportButtons mainboard={mainboard} sideboard={sideboard} />
              {shareUrl && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(shareUrl);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded transition-colors"
                >
                  {copiedLink ? "Copied!" : "Copy share link"}
                </button>
              )}
            </div>
          </div>

          {/* Deck info: price + legality */}
          <div className="space-y-2">
            <PriceTotal entries={[...mainboard, ...sideboard]} />
            <LegalityBadges entries={[...mainboard, ...sideboard]} />
          </div>

          {/* Deck — mainboard + sideboard in one layout */}
          <DeckViewer
            entries={mainboard}
            sideboardEntries={sideboard}
            deckName={deckName}
            deckAuthor={deckAuthor}
          />
        </div>
      )}
    </main>
  );
}
