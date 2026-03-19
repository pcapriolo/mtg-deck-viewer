"use client";

import { useState, useRef, useCallback } from "react";
import { ScryfallCard, cardImageUri } from "@/lib/scryfall";

interface CardHoverProps {
  card: ScryfallCard;
  quantity: number;
  children: React.ReactNode;
}

/**
 * Wraps any content and shows a large card image on hover.
 * Positions the popup to whichever side of the viewport has more space.
 */
export default function CardHover({ card, quantity, children }: CardHoverProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number; side: "left" | "right" }>({
    x: 0,
    y: 0,
    side: "right",
  });
  const ref = useRef<HTMLDivElement>(null);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const cardWidth = 250;
    const gap = 12;

    const side = rect.left > viewportWidth / 2 ? "left" : "right";
    const x = side === "right" ? rect.right + gap : rect.left - cardWidth - gap;
    const y = Math.max(8, Math.min(rect.top, window.innerHeight - 370));

    setPosition({ x, y, side });
    setVisible(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setVisible(false);
  }, []);

  const imageUrl = cardImageUri(card, "normal");
  const price = card.prices?.usd ? `$${card.prices.usd}` : null;

  return (
    <div
      ref={ref}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="relative"
    >
      {children}

      {visible && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: position.x, top: position.y }}
        >
          <div className="bg-gray-900 rounded-lg shadow-2xl overflow-hidden border border-gray-700">
            {imageUrl && (
              <img
                src={imageUrl}
                alt={card.name}
                className="w-[250px] rounded-t-lg"
                loading="eager"
              />
            )}
            <div className="p-2 text-xs text-gray-300 space-y-1">
              <div className="flex justify-between items-center">
                <span className="font-medium text-white truncate">{card.name}</span>
                {price && <span className="text-green-400 ml-2 shrink-0">{price}</span>}
              </div>
              <div className="text-gray-400">{card.type_line}</div>
              {card.oracle_text && (
                <div className="text-gray-400 line-clamp-3 text-[11px] leading-tight">
                  {card.oracle_text}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
