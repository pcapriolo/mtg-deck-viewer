"use client";

import { ScryfallCard } from "@/lib/scryfall";

interface ManaCurveProps {
  cards: Array<{ card: ScryfallCard; quantity: number }>;
}

/**
 * Mana curve histogram — shows card count distribution by mana value.
 * Excludes lands. Groups 7+ together.
 */
export default function ManaCurve({ cards }: ManaCurveProps) {
  const nonLands = cards.filter((c) => !c.card.type_line.toLowerCase().includes("land"));

  const buckets = new Map<number, number>();
  for (const { card, quantity } of nonLands) {
    const mv = Math.min(Math.floor(card.cmc), 7);
    buckets.set(mv, (buckets.get(mv) ?? 0) + quantity);
  }

  const maxCount = Math.max(...Array.from(buckets.values()), 1);
  const labels = [0, 1, 2, 3, 4, 5, 6, 7];

  return (
    <div className="flex items-end gap-1 h-16">
      {labels.map((mv) => {
        const count = buckets.get(mv) ?? 0;
        const height = count > 0 ? Math.max(4, (count / maxCount) * 56) : 0;

        return (
          <div key={mv} className="flex flex-col items-center gap-0.5 flex-1">
            {count > 0 && (
              <span className="text-[10px] text-gray-400">{count}</span>
            )}
            <div
              className="w-full bg-amber-500/80 rounded-sm transition-all"
              style={{ height }}
            />
            <span className="text-[10px] text-gray-500">
              {mv === 7 ? "7+" : mv}
            </span>
          </div>
        );
      })}
    </div>
  );
}
