"use client";

import { useState, useRef, useCallback } from "react";
import { ScryfallCard, cardImageUri } from "@/lib/scryfall";

interface CardHoverProps {
  card: ScryfallCard;
  quantity: number;
  children: React.ReactNode;
}

/**
 * Wraps any content and shows a large card image on hover (desktop)
 * or on tap (mobile, centered with a dismiss overlay).
 *
 * The popup is just the card image — clean, no redundant text.
 * Price shown as a small overlay badge.
 */
export default function CardHover({ card, quantity, children }: CardHoverProps) {
  const [visible, setVisible] = useState(false);
  const [isTouch, setIsTouch] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popupW = 280;
    const popupH = 390;
    const gap = 16;

    // Position: prefer right, fall back to left
    let x = rect.right + gap;
    if (x + popupW > vw) {
      x = rect.left - popupW - gap;
    }
    // Clamp to viewport
    x = Math.max(8, Math.min(x, vw - popupW - 8));

    // Vertical: center on the card row, clamp to viewport
    let y = rect.top + rect.height / 2 - popupH / 2;
    y = Math.max(8, Math.min(y, vh - popupH - 8));

    setPosition({ x, y });
    setIsTouch(false);
    setVisible(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!isTouch) {
      setVisible(false);
    }
  }, [isTouch]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    setIsTouch(true);
    setVisible(true);
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setIsTouch(false);
  }, []);

  const imageUrl = cardImageUri(card, "large");
  const price = card.prices?.usd ? `$${card.prices.usd}` : null;

  return (
    <div
      ref={ref}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      className="relative"
    >
      {children}

      {/* Touch dismiss overlay */}
      {visible && isTouch && (
        <div
          className="fixed inset-0 z-40 bg-black/60"
          onTouchStart={dismiss}
          onClick={dismiss}
        />
      )}

      {visible && (
        <div
          className={`fixed z-50 ${isTouch ? "pointer-events-auto" : "pointer-events-none"}`}
          style={
            isTouch
              ? { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
              : { left: position.x, top: position.y }
          }
        >
          <div className="relative rounded-xl overflow-hidden shadow-2xl shadow-black/60">
            {/* Card image — the whole popup */}
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={card.name}
                className="w-[280px] block rounded-xl"
                loading="eager"
              />
            ) : (
              <div className="w-[280px] h-[390px] bg-gray-800 rounded-xl flex items-center justify-center text-gray-400 text-sm">
                {card.name}
              </div>
            )}

            {/* Price badge — floating bottom-right */}
            {price && (
              <div className="absolute bottom-2 right-2 bg-black/75 backdrop-blur-sm text-green-400 text-xs font-medium px-2 py-0.5 rounded-md">
                {price}
              </div>
            )}

            {/* Quantity badge — floating top-left (only on touch where context is less clear) */}
            {isTouch && quantity > 1 && (
              <div className="absolute top-2 left-2 bg-black/75 backdrop-blur-sm text-white text-xs font-bold px-2 py-0.5 rounded-md">
                ×{quantity}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
