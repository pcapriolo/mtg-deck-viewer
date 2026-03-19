"use client";

import { ResolvedEntry } from "@/lib/types";

interface LegalityBadgesProps {
  entries: ResolvedEntry[];
}

const FORMATS = [
  "standard",
  "pioneer",
  "modern",
  "legacy",
  "vintage",
  "commander",
  "pauper",
] as const;

export default function LegalityBadges({ entries }: LegalityBadgesProps) {
  const formatLegality = FORMATS.map((format) => {
    const isLegal =
      entries.length > 0 &&
      entries.every((e) => e.card.legalities[format] === "legal");
    return { format, isLegal };
  });

  return (
    <div className="flex flex-wrap gap-1.5">
      {formatLegality.map(({ format, isLegal }) => (
        <span
          key={format}
          className={
            isLegal
              ? "px-2 py-0.5 rounded-full text-[10px] uppercase bg-green-900/30 text-green-400 border border-green-800/40"
              : "px-2 py-0.5 rounded-full text-[10px] uppercase bg-gray-800/50 text-gray-600"
          }
        >
          {format}
        </span>
      ))}
    </div>
  );
}
