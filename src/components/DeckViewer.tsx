"use client";

import { useMemo } from "react";
import {
  ScryfallCard,
  categorizeCard,
  categoryOrder,
  cardImageUri,
  CardCategory,
  COLOR_MAP,
} from "@/lib/scryfall";
import { DeckEntry } from "@/lib/parser";
import CardHover from "./CardHover";
import ManaCurve from "./ManaCurve";

interface ResolvedEntry {
  entry: DeckEntry;
  card: ScryfallCard;
}

interface DeckViewerProps {
  entries: ResolvedEntry[];
  deckName?: string;
  section?: string;
}

/**
 * The main deck viewer — groups cards by type, shows thumbnails with hover.
 */
export default function DeckViewer({ entries, deckName, section = "Mainboard" }: DeckViewerProps) {
  const grouped = useMemo(() => {
    const groups = new Map<CardCategory, ResolvedEntry[]>();

    const sorted = [...entries].sort((a, b) => {
      const catDiff = categoryOrder(categorizeCard(a.card)) - categoryOrder(categorizeCard(b.card));
      if (catDiff !== 0) return catDiff;
      return a.card.cmc - b.card.cmc;
    });

    for (const entry of sorted) {
      const cat = categorizeCard(entry.card);
      const list = groups.get(cat) ?? [];
      list.push(entry);
      groups.set(cat, list);
    }

    return groups;
  }, [entries]);

  const totalCards = entries.reduce((sum, e) => sum + e.entry.quantity, 0);

  const colorIdentity = useMemo(() => {
    const colors = new Set<string>();
    for (const { card } of entries) {
      for (const c of card.color_identity) {
        colors.add(c);
      }
    }
    return Array.from(colors);
  }, [entries]);

  const curveData = useMemo(
    () => entries.map(({ card, entry }) => ({ card, quantity: entry.quantity })),
    [entries]
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {deckName && <h2 className="text-lg font-semibold text-white">{deckName}</h2>}
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span>{section}</span>
            <span>·</span>
            <span>{totalCards} cards</span>
            {colorIdentity.length > 0 && (
              <>
                <span>·</span>
                <div className="flex gap-0.5">
                  {colorIdentity.map((c) => (
                    <span
                      key={c}
                      className="w-4 h-4 rounded-full border border-gray-600"
                      style={{ backgroundColor: COLOR_MAP[c]?.hex ?? "#888" }}
                      title={COLOR_MAP[c]?.name ?? c}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Card groups */}
      <div className="space-y-3">
        {Array.from(grouped.entries()).map(([category, items]) => {
          const count = items.reduce((sum, e) => sum + e.entry.quantity, 0);
          return (
            <div key={category}>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                {category} ({count})
              </div>
              <div className="space-y-px">
                {items.map(({ entry, card }) => (
                  <CardRow key={card.id + entry.section} card={card} quantity={entry.quantity} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Stats */}
      <div className="border-t border-gray-800 pt-3">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Mana Curve
        </div>
        <ManaCurve cards={curveData} />
      </div>
    </div>
  );
}

function CardRow({ card, quantity }: { card: ScryfallCard; quantity: number }) {
  const imageUrl = cardImageUri(card, "small");
  const manaCost = card.mana_cost || card.card_faces?.[0]?.mana_cost || "";

  return (
    <CardHover card={card} quantity={quantity}>
      <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-800/60 transition-colors cursor-default group">
        {/* Quantity */}
        <span className="text-sm text-gray-500 w-5 text-right font-mono">{quantity}</span>

        {/* Thumbnail */}
        <div className="w-8 h-6 rounded overflow-hidden bg-gray-800 shrink-0">
          {imageUrl && (
            <img
              src={imageUrl}
              alt=""
              className="w-full h-full object-cover object-[50%_25%]"
              loading="lazy"
            />
          )}
        </div>

        {/* Name */}
        <span className="text-sm text-gray-200 group-hover:text-white truncate flex-1">
          {card.name}
        </span>

        {/* Mana cost symbols (simplified) */}
        <span className="text-xs text-gray-500 shrink-0 font-mono">
          {formatManaCost(manaCost)}
        </span>
      </div>
    </CardHover>
  );
}

/**
 * Simplify mana cost string: {2}{U}{U} → 2UU
 */
function formatManaCost(cost: string): string {
  return cost.replace(/\{([^}]+)\}/g, (_, symbol) => {
    if (symbol === "X") return "X";
    return symbol;
  });
}
