/**
 * Encode/decode decklists into URL-safe strings.
 *
 * Format: compact text representation → compressed → base64url
 * Keeps URLs self-contained with no database needed.
 */

import { DeckEntry, ParsedDeck, parseDeckList } from "./parser";

/**
 * Encode a parsed deck into a URL-safe string.
 * Uses a compact text format: "4 Card Name\n" with "---" as section separator.
 */
export function encodeDeck(deck: ParsedDeck): string {
  const sections = new Map<string, DeckEntry[]>();

  for (const entry of deck.entries) {
    const list = sections.get(entry.section) ?? [];
    list.push(entry);
    sections.set(entry.section, list);
  }

  const parts: string[] = [];

  if (deck.name) {
    parts.push(`#${deck.name}`);
  }

  const sectionOrder = ["commander", "companion", "mainboard", "sideboard"];
  for (const section of sectionOrder) {
    const entries = sections.get(section);
    if (!entries?.length) continue;

    if (parts.length > 0) parts.push("---");
    if (section !== "mainboard") parts.push(`@${section}`);

    for (const entry of entries) {
      parts.push(`${entry.quantity} ${entry.name}`);
    }
  }

  const text = parts.join("\n");

  // Use browser/node TextEncoder + compression if available, else raw base64
  try {
    const bytes = new TextEncoder().encode(text);
    return base64UrlEncode(bytes);
  } catch {
    return btoa(text);
  }
}

/**
 * Decode a URL-safe string back into a ParsedDeck.
 */
export function decodeDeck(encoded: string): ParsedDeck {
  try {
    const bytes = base64UrlDecode(encoded);
    const text = new TextDecoder().decode(bytes);
    return parseCompactFormat(text);
  } catch {
    const text = atob(encoded);
    return parseCompactFormat(text);
  }
}

function parseCompactFormat(text: string): ParsedDeck {
  const lines = text.split("\n");
  let name: string | undefined;
  let currentSection: DeckEntry["section"] = "mainboard";
  const entries: DeckEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") continue;

    if (trimmed.startsWith("#")) {
      name = trimmed.slice(1).trim();
      continue;
    }

    if (trimmed.startsWith("@")) {
      currentSection = trimmed.slice(1).trim() as DeckEntry["section"];
      continue;
    }

    // Re-use the main parser logic for card lines
    const match = trimmed.match(/^(\d+)\s+(.+)$/);
    if (match) {
      entries.push({
        quantity: parseInt(match[1], 10),
        name: match[2].trim(),
        section: currentSection,
      });
    }
  }

  return { entries, name };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
