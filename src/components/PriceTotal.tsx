"use client";

import { ResolvedEntry } from "@/lib/types";

interface PriceTotalProps {
  entries: ResolvedEntry[];
}

export default function PriceTotal({ entries }: PriceTotalProps) {
  let total = 0;
  let hasAnyPrice = false;

  for (const { entry, card } of entries) {
    const usd = card.prices.usd;
    if (usd != null && usd !== "") {
      total += parseFloat(usd) * entry.quantity;
      hasAnyPrice = true;
    }
  }

  if (!hasAnyPrice) {
    return <span className="text-xs text-gray-400">Prices unavailable</span>;
  }

  return (
    <span className="text-xs text-gray-400">
      Estimated: ${total.toFixed(2)}
    </span>
  );
}
