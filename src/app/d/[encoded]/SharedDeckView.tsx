"use client";

import type { ResolvedEntry } from "@/lib/types";
import DeckViewer from "@/components/DeckViewer";
import PriceTotal from "@/components/PriceTotal";
import LegalityBadges from "@/components/LegalityBadges";
import ExportButtons from "@/components/ExportButtons";

interface SharedDeckViewProps {
  mainboard: ResolvedEntry[];
  sideboard: ResolvedEntry[];
  deckName?: string;
  encoded: string;
}

export default function SharedDeckView({
  mainboard,
  sideboard,
  deckName,
  encoded,
}: SharedDeckViewProps) {
  const allEntries = [...mainboard, ...sideboard];

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <a
          href="/"
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          &larr; New deck
        </a>
        <div className="flex items-center gap-2">
          <ExportButtons mainboard={mainboard} sideboard={sideboard} />
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
            }}
            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded transition-colors"
          >
            Copy link
          </button>
        </div>
      </div>

      {/* Mainboard */}
      <DeckViewer entries={mainboard} deckName={deckName} section="Mainboard" />

      {/* Sideboard */}
      {sideboard.length > 0 && (
        <div className="border-t border-gray-800 pt-4 mt-6">
          <DeckViewer entries={sideboard} section="Sideboard" />
        </div>
      )}

      {/* Footer: price, legality, export */}
      <div className="border-t border-gray-800 pt-4 mt-6 space-y-3">
        <div className="flex items-center justify-between">
          <PriceTotal entries={allEntries} />
        </div>
        <LegalityBadges entries={allEntries} />
      </div>
    </main>
  );
}
