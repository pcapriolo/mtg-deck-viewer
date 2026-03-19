"use client";

import { useMemo, useState } from "react";
import {
  ScryfallCard,
  categorizeCard,
  cardImageUri,
  CardCategory,
  COLOR_MAP,
} from "@/lib/scryfall";
import { ResolvedEntry } from "@/lib/types";
import CardHover from "./CardHover";

interface DeckViewerProps {
  entries: ResolvedEntry[];
  sideboardEntries?: ResolvedEntry[];
  deckName?: string;
  deckAuthor?: string;
}

/* ────────────────────────────────────────────
 * Layout reference (what we're building):
 *
 *  ┌─────────────────────────────────────────────────────────┬──────────┐
 *  │  Deck Name                                              │          │
 *  │  Format · $XXX · Color bar · Type counts · Mana curve   │          │
 *  ├─────────────────────────────────────────────────────────┤ SIDEBOARD│
 *  │  [creature stacks in a row ...]                         │ [stacks] │
 *  │  [spell + land stacks in a row ...]                     │          │
 *  └─────────────────────────────────────────────────────────┴──────────┘
 * ──────────────────────────────────────────── */

const CARD_W = 170;
const CARD_H = 237; // MTG ratio ~1.395
const STACK_PEEK = 24; // only the name bar peeks out

const CREATURE_CATS: CardCategory[] = ["Creature", "Planeswalker"];
const SPELL_CATS: CardCategory[] = ["Instant", "Sorcery", "Enchantment", "Artifact", "Other"];
const LAND_CATS: CardCategory[] = ["Land"];

// Type symbols (unicode approximations)
const TYPE_ICONS: Partial<Record<CardCategory, string>> = {
  Creature: "👾",
  Planeswalker: "🌟",
  Instant: "⚡",
  Sorcery: "🔮",
  Enchantment: "✨",
  Artifact: "⚙️",
  Land: "🏔️",
};

export default function DeckViewer({
  entries,
  sideboardEntries = [],
  deckName,
  deckAuthor,
}: DeckViewerProps) {
  const [editName, setEditName] = useState(deckName ?? "");
  const [editAuthor, setEditAuthor] = useState(deckAuthor ?? "");
  const [editingName, setEditingName] = useState(false);
  const [editingAuthor, setEditingAuthor] = useState(false);
  // Group mainboard cards by category, sorted by CMC within each
  const grouped = useMemo(() => {
    const groups = new Map<CardCategory, ResolvedEntry[]>();
    const sorted = [...entries].sort((a, b) => a.card.cmc - b.card.cmc);
    for (const entry of sorted) {
      const cat = categorizeCard(entry.card);
      const list = groups.get(cat) ?? [];
      list.push(entry);
      groups.set(cat, list);
    }
    return groups;
  }, [entries]);

  // Split into two rows: creatures + non-creatures
  const creatureRow = useMemo(() => {
    const result: ResolvedEntry[] = [];
    for (const cat of CREATURE_CATS) {
      const items = grouped.get(cat);
      if (items) result.push(...items);
    }
    return result;
  }, [grouped]);

  const spellRow = useMemo(() => {
    const result: ResolvedEntry[] = [];
    for (const cat of [...SPELL_CATS, ...LAND_CATS]) {
      const items = grouped.get(cat);
      if (items) result.push(...items);
    }
    return result;
  }, [grouped]);

  // Stats
  const totalCards = entries.reduce((sum, e) => sum + e.entry.quantity, 0);

  const colorIdentity = useMemo(() => {
    const colors = new Set<string>();
    for (const { card } of entries) {
      for (const c of card.color_identity) colors.add(c);
    }
    return Array.from(colors);
  }, [entries]);

  const typeCounts = useMemo(() => {
    const counts = new Map<CardCategory, number>();
    for (const { entry, card } of entries) {
      const cat = categorizeCard(card);
      counts.set(cat, (counts.get(cat) ?? 0) + entry.quantity);
    }
    return counts;
  }, [entries]);

  // Mana curve data (non-lands)
  const curveBuckets = useMemo(() => {
    const buckets = new Array(8).fill(0);
    for (const { card, entry } of entries) {
      if (card.type_line.toLowerCase().includes("land")) continue;
      const mv = Math.min(Math.floor(card.cmc), 7);
      buckets[mv] += entry.quantity;
    }
    return buckets;
  }, [entries]);
  const curveMax = Math.max(...curveBuckets, 1);

  const sideboardTotal = sideboardEntries.reduce((sum, e) => sum + e.entry.quantity, 0);

  // Sort sideboard by CMC
  const sortedSideboard = useMemo(
    () => [...sideboardEntries].sort((a, b) => a.card.cmc - b.card.cmc),
    [sideboardEntries]
  );

  return (
    <div className="space-y-0">
      {/* ── Header ────────────────────────────────── */}
      <div className="bg-gray-900/80 border border-gray-700/50 rounded-t-xl px-5 py-4">
        {/* Editable deck name */}
        <div className="flex items-baseline gap-3 mb-1">
          {editingName ? (
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => setEditingName(false)}
              onKeyDown={(e) => { if (e.key === "Enter") setEditingName(false); }}
              placeholder="Deck name"
              className="text-2xl font-bold text-white bg-transparent border-b border-amber-500/50 outline-none w-full max-w-md"
            />
          ) : (
            <h2
              onClick={() => setEditingName(true)}
              className="text-2xl font-bold text-white cursor-pointer hover:text-amber-400 transition-colors"
              title="Click to edit deck name"
            >
              {editName || "Untitled Deck"}
            </h2>
          )}

          {/* Editable author */}
          {editingAuthor ? (
            <input
              autoFocus
              value={editAuthor}
              onChange={(e) => setEditAuthor(e.target.value)}
              onBlur={() => setEditingAuthor(false)}
              onKeyDown={(e) => { if (e.key === "Enter") setEditingAuthor(false); }}
              placeholder="Author"
              className="text-sm text-gray-400 bg-transparent border-b border-amber-500/50 outline-none w-40"
            />
          ) : (
            <span
              onClick={() => setEditingAuthor(true)}
              className="text-sm text-gray-500 cursor-pointer hover:text-gray-300 transition-colors"
              title="Click to edit author"
            >
              {editAuthor || "Add author"}
            </span>
          )}
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* Color identity bar */}
          {colorIdentity.length > 0 && (
            <div className="flex gap-1">
              {colorIdentity.map((c) => (
                <span
                  key={c}
                  className="w-5 h-5 rounded-full border-2 border-gray-600"
                  style={{ backgroundColor: COLOR_MAP[c]?.hex ?? "#888" }}
                  title={COLOR_MAP[c]?.name ?? c}
                />
              ))}
            </div>
          )}

          {/* Card count */}
          <span className="text-sm text-gray-400 font-medium">{totalCards} cards</span>

          {/* Type breakdown */}
          <div className="flex items-center gap-3 text-xs text-gray-400">
            {Array.from(typeCounts.entries()).map(([cat, count]) => (
              <span key={cat} className="flex items-center gap-1" title={cat}>
                <span className="text-sm">{TYPE_ICONS[cat] ?? "•"}</span>
                <span className="font-medium">{count}</span>
              </span>
            ))}
          </div>

          {/* Inline mana curve */}
          <div className="flex items-end gap-[3px] h-8 ml-auto">
            {curveBuckets.map((count, mv) => {
              const h = count > 0 ? Math.max(3, (count / curveMax) * 28) : 0;
              return (
                <div key={mv} className="flex flex-col items-center w-4">
                  {count > 0 && (
                    <span className="text-[9px] text-gray-400 leading-none mb-0.5">{count}</span>
                  )}
                  <div
                    className="w-3 bg-amber-500/80 rounded-sm"
                    style={{ height: h }}
                  />
                  <span className="text-[8px] text-gray-500 leading-none mt-0.5">
                    {mv === 7 ? "7+" : mv}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Card grid + Sideboard ─────────────────── */}
      <div className="flex border border-t-0 border-gray-700/50 rounded-b-xl overflow-hidden bg-gray-950/50">
        {/* Mainboard */}
        <div className="flex-1 p-3 space-y-2 min-w-0">
          {/* Row 1: Creatures */}
          {creatureRow.length > 0 && (
            <CardRow cards={creatureRow} />
          )}
          {/* Row 2: Spells + Lands */}
          {spellRow.length > 0 && (
            <CardRow cards={spellRow} />
          )}
        </div>

        {/* Sideboard */}
        {sideboardEntries.length > 0 && (
          <div className="relative border-l border-gray-700/50 bg-gray-900/30 p-3 flex flex-col" style={{ width: CARD_W + 24 }}>
            {/* Vertical "SIDEBOARD" label */}
            <div className="absolute -left-3 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] font-bold uppercase tracking-[0.3em] text-gray-500 whitespace-nowrap pointer-events-none select-none">
              Sideboard · {sideboardTotal}
            </div>
            <div className="ml-2 space-y-0.5">
              {sortedSideboard.map(({ entry, card }) => (
                <CardStack key={card.id + "sb"} card={card} quantity={entry.quantity} compact />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A horizontal row of card stacks */
function CardRow({ cards }: { cards: ResolvedEntry[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {cards.map(({ entry, card }) => (
        <CardStack key={card.id + entry.section} card={card} quantity={entry.quantity} />
      ))}
    </div>
  );
}

/**
 * A stack of N copies — only the name bar peeks out for copies above the last.
 */
function CardStack({
  card,
  quantity,
  compact = false,
}: {
  card: ScryfallCard;
  quantity: number;
  compact?: boolean;
}) {
  const imageUrl = cardImageUri(card, "normal");
  const w = compact ? 140 : CARD_W;
  const h = compact ? 195 : CARD_H;
  const peek = compact ? 20 : STACK_PEEK;
  const stackHeight = h + (quantity - 1) * peek;

  return (
    <CardHover card={card} quantity={quantity}>
      <div
        className="relative shrink-0 cursor-pointer"
        style={{ width: w, height: stackHeight }}
      >
        {Array.from({ length: quantity }).map((_, i) => (
          <div
            key={i}
            className="absolute left-0 rounded-[8px] overflow-hidden"
            style={{
              top: i * peek,
              width: w,
              height: h,
              zIndex: i,
              boxShadow: i < quantity - 1
                ? "0 1px 2px rgba(0,0,0,0.4)"
                : "0 4px 12px rgba(0,0,0,0.5)",
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
              <div className="w-full h-full bg-gray-800 flex items-center justify-center text-gray-500 text-[10px] p-1 text-center leading-tight">
                {card.name}
              </div>
            )}
          </div>
        ))}
        {/* Quantity badge */}
        {quantity > 1 && (
          <div
            className="absolute top-0.5 right-1 z-50 bg-black/70 text-white text-[10px] font-bold rounded-full w-[18px] h-[18px] flex items-center justify-center backdrop-blur-sm"
            style={{ zIndex: quantity + 1 }}
          >
            {quantity}
          </div>
        )}
      </div>
    </CardHover>
  );
}

export function formatManaCost(cost: string): string {
  return cost.replace(/\{([^}]+)\}/g, (_, symbol) => {
    if (symbol === "X") return "X";
    return symbol;
  });
}
