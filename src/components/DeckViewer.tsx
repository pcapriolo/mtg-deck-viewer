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
import { ResolvedEntry } from "@/lib/types";
import CardHover from "./CardHover";
import ManaCurve from "./ManaCurve";

interface DeckViewerProps {
  entries: ResolvedEntry[];
  deckName?: string;
  section?: string;
}

/**
 * Visual deck viewer — cards displayed as stacked images in a grid.
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │  CREATURE (16)                            │
 *   │  [card][card][card][card][card]...        │
 *   │  INSTANT (14)                             │
 *   │  [card][card][card][card]...              │
 *   │  LAND (20)                                │
 *   │  [card][card][card][card][card]...        │
 *   └──────────────────────────────────────────┘
 *
 * Each [card] is a stack of N copies, overlapping vertically.
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

      {/* Card grid — stacked card images by category */}
      <div className="space-y-1">
        {Array.from(grouped.entries()).map(([category, items]) => {
          const count = items.reduce((sum, e) => sum + e.entry.quantity, 0);
          return (
            <div key={category}>
              <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-0.5 px-0.5">
                {category} ({count})
              </div>
              <div className="flex flex-wrap gap-1">
                {items.map(({ entry, card }) => (
                  <CardStack
                    key={card.id + entry.section}
                    card={card}
                    quantity={entry.quantity}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mana Curve */}
      <div className="border-t border-gray-800 pt-3">
        <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-2">
          Mana Curve
        </div>
        <ManaCurve cards={curveData} />
      </div>
    </div>
  );
}

/**
 * A stack of N copies of the same card, overlapping vertically.
 * The bottom card is fully visible; copies above peek out by STACK_OFFSET px.
 *
 *   ┌──────────┐  ← copy 1 (only top sliver visible)
 *   │  ┌──────────┐  ← copy 2
 *   │  │  ┌──────────┐  ← copy 3
 *   │  │  │          │
 *   │  │  │  (full)  │  ← last copy fully visible
 *   │  │  │          │
 *   └  └  └──────────┘
 */
const CARD_WIDTH = 130;
const CARD_HEIGHT = 182; // ~1.4:1 MTG card ratio
const STACK_OFFSET = 26; // px between stacked copies

function CardStack({ card, quantity }: { card: ScryfallCard; quantity: number }) {
  const imageUrl = cardImageUri(card, "normal");
  const stackHeight = CARD_HEIGHT + (quantity - 1) * STACK_OFFSET;

  return (
    <CardHover card={card} quantity={quantity}>
      <div
        className="relative shrink-0 cursor-pointer"
        style={{ width: CARD_WIDTH, height: stackHeight }}
      >
        {Array.from({ length: quantity }).map((_, i) => (
          <div
            key={i}
            className="absolute left-0 rounded-[6px] overflow-hidden shadow-md border border-gray-700/50"
            style={{
              top: i * STACK_OFFSET,
              width: CARD_WIDTH,
              height: CARD_HEIGHT,
              zIndex: i,
            }}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={i === quantity - 1 ? card.name : ""}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full bg-gray-800 flex items-center justify-center text-gray-500 text-xs p-2 text-center">
                {card.name}
              </div>
            )}
          </div>
        ))}
        {/* Quantity badge */}
        {quantity > 1 && (
          <div
            className="absolute top-1 left-1 z-50 bg-black/80 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center border border-gray-600"
          >
            {quantity}
          </div>
        )}
      </div>
    </CardHover>
  );
}

/**
 * Simplify mana cost string: {2}{U}{U} → 2UU
 */
export function formatManaCost(cost: string): string {
  return cost.replace(/\{([^}]+)\}/g, (_, symbol) => {
    if (symbol === "X") return "X";
    return symbol;
  });
}
