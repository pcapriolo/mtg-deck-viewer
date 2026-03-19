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
 * For double-faced cards (transform/modal_dfc), shows a flip button
 * to toggle between front and back face.
 */
export default function CardHover({ card, quantity, children }: CardHoverProps) {
  const [visible, setVisible] = useState(false);
  const [isTouch, setIsTouch] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const isDFC = card.card_faces && card.card_faces.length >= 2 &&
    card.card_faces[0]?.image_uris && card.card_faces[1]?.image_uris;

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popupW = 280;
    const popupH = 420;
    const gap = 16;

    let x = rect.right + gap;
    if (x + popupW > vw) x = rect.left - popupW - gap;
    x = Math.max(8, Math.min(x, vw - popupW - 8));

    let y = rect.top + rect.height / 2 - popupH / 2;
    y = Math.max(8, Math.min(y, vh - popupH - 8));

    setPosition({ x, y });
    setIsTouch(false);
    setFlipped(false);
    setVisible(true);
  }, []);

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseLeave = useCallback(() => {
    if (!isTouch) {
      // Small delay so user can move mouse to the popup
      hideTimer.current = setTimeout(() => {
        setVisible(false);
        setFlipped(false);
      }, 150);
    }
  }, [isTouch]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    setIsTouch(true);
    setFlipped(false);
    setVisible(true);
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setIsTouch(false);
    setFlipped(false);
  }, []);

  // Determine which image to show
  let imageUrl: string;
  if (isDFC && flipped) {
    imageUrl = card.card_faces![1].image_uris!.large;
  } else if (isDFC) {
    imageUrl = card.card_faces![0].image_uris!.large;
  } else {
    imageUrl = cardImageUri(card, "large");
  }

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
          className="fixed z-50 pointer-events-auto"
          style={
            isTouch
              ? { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
              : { left: position.x, top: position.y }
          }
          onMouseEnter={() => {
            if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
          }}
          onMouseLeave={() => {
            if (!isTouch) { setVisible(false); setFlipped(false); }
          }}
        >
          <div className="relative rounded-xl overflow-hidden shadow-2xl shadow-black/60">
            {/* Card image */}
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

            {/* Price badge */}
            {price && (
              <div className="absolute bottom-2 right-2 bg-black/75 backdrop-blur-sm text-green-400 text-xs font-medium px-2 py-0.5 rounded-md">
                {price}
              </div>
            )}

            {/* Transform / flip button for DFCs */}
            {isDFC && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFlipped((f) => !f);
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                }}
                className="pointer-events-auto absolute bottom-2 left-2 bg-black/75 backdrop-blur-sm text-white text-[11px] font-medium pl-1.5 pr-2.5 py-1 rounded-md hover:bg-black/90 transition-colors flex items-center gap-1 cursor-pointer"
                title="Flip card"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm4.5 0a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3zM8 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/>
                </svg>
                {flipped ? "Front" : "Transform"}
              </button>
            )}

            {/* Quantity badge (touch only) */}
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
