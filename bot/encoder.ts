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
 * Compose the reply tweet text with deck name, color pips, and link.
 *
 * Format:
 *   Carnosaur Technique · 60 cards
 *   🔵🔴🟢
 *
 *   ▶ View deck →
 *
 * Fallback (no name, colorless):
 *   60-card deck
 *
 *   ▶ View deck →
 */
export function composeReplyText(
  stats: { mainCount: number; sideCount: number; colorPips: string },
  deckName?: string
): string {
  const lines: string[] = [];

  // Line 1: deck name + card count
  if (deckName) {
    // Truncate very long names to stay within 280-char tweet limit
    const truncatedName = deckName.length > 50 ? deckName.slice(0, 47) + "..." : deckName;
    lines.push(`${truncatedName} · ${stats.mainCount} cards`);
  } else {
    lines.push(`${stats.mainCount}-card deck`);
  }

  // Line 2: color pips (omit if colorless)
  if (stats.colorPips) lines.push(stats.colorPips);

  // Blank line + link prompt
  lines.push("");
  lines.push("▶ View deck →");

  return lines.join("\n");
}

/**
 * Extract deck name from raw decklist text (looks for "Name: X" line).
 */
export function extractDeckName(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const match = line.match(/^name[:\s]+(.+)$/i);
    if (match) return match[1].trim();
  }
  return undefined;
}

/** Legacy compat — simple summary without stats */
export function summarizeDecklist(text: string): string {
  const lines = text.split("\n").filter((l) => l.trim());
  let inSideboard = false;
  let mainCount = 0;
  let sideCount = 0;

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed === "sideboard" || trimmed === "side" || trimmed === "") {
      inSideboard = true;
      continue;
    }
    if (/^(name|author)[:\s]/i.test(trimmed)) continue;
    const match = line.match(/^(\d+)\s/);
    if (match) {
      const qty = parseInt(match[1]);
      if (inSideboard) sideCount += qty;
      else mainCount += qty;
    }
  }

  const name = extractDeckName(text);
  const parts: string[] = [];
  if (name) parts.push(name);
  parts.push(`${mainCount}-card deck`);
  if (sideCount > 0) parts.push(`${sideCount}-card sideboard`);
  return parts.join(" · ");
}
