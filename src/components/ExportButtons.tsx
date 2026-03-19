"use client";

import { useState, useCallback } from "react";
import { ResolvedEntry } from "@/lib/types";
import { exportAsArena, exportAsMTGO } from "@/lib/deck-exporter";

interface ExportButtonsProps {
  mainboard: ResolvedEntry[];
  sideboard: ResolvedEntry[];
}

type CopiedState = "arena" | "mtgo" | null;

export default function ExportButtons({ mainboard, sideboard }: ExportButtonsProps) {
  const [copied, setCopied] = useState<CopiedState>(null);

  const copyToClipboard = useCallback(
    async (format: "arena" | "mtgo") => {
      const text =
        format === "arena"
          ? exportAsArena(mainboard, sideboard)
          : exportAsMTGO(mainboard, sideboard);

      try {
        await navigator.clipboard.writeText(text);
        setCopied(format);
        setTimeout(() => setCopied(null), 2000);
      } catch {
        // Clipboard API may fail in non-secure contexts; silently ignore
      }
    },
    [mainboard, sideboard]
  );

  const buttonClass =
    "text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2.5 py-1 rounded";

  return (
    <div className="flex gap-2">
      <button className={buttonClass} onClick={() => copyToClipboard("arena")}>
        {copied === "arena" ? "Copied!" : "Arena"}
      </button>
      <button className={buttonClass} onClick={() => copyToClipboard("mtgo")}>
        {copied === "mtgo" ? "Copied!" : "MTGO"}
      </button>
    </div>
  );
}
