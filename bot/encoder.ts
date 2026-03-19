/**
 * Deck URL encoder — mirrors src/lib/deck-encoder.ts but runs in Node.js.
 * Compresses decklist text with pako deflate, then base64url-encodes it.
 */

import { deflate } from "pako";

export function encodeDeckUrl(decklistText: string, baseUrl: string): string {
  const bytes = new TextEncoder().encode(decklistText);
  const compressed = deflate(bytes);
  const encoded = base64UrlEncode(compressed);
  return `${baseUrl}/d/${encoded}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  const binary = Buffer.from(bytes).toString("base64");
  return binary.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generate a short summary of a decklist for the reply tweet.
 * Example: "60-card deck · W/R · 20 creatures, 16 spells, 24 lands"
 */
export function summarizeDecklist(text: string): string {
  const lines = text.split("\n").filter((l) => l.trim());
  let total = 0;
  let inSideboard = false;
  let mainCount = 0;
  let sideCount = 0;

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed === "sideboard" || trimmed === "side" || trimmed === "") {
      inSideboard = true;
      continue;
    }
    const match = line.match(/^(\d+)\s/);
    if (match) {
      const qty = parseInt(match[1]);
      total += qty;
      if (inSideboard) sideCount += qty;
      else mainCount += qty;
    }
  }

  const parts = [`${mainCount}-card deck`];
  if (sideCount > 0) parts.push(`${sideCount}-card sideboard`);
  return parts.join(" · ");
}
