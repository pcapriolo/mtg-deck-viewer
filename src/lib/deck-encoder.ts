/**
 * Encode/decode decklists into URL-safe strings.
 *
 * Format: compact text → deflate → base64url
 * Keeps URLs self-contained with no database needed.
 */

import { deflate, inflate } from "pako";
import { DeckEntry, ParsedDeck, parseDeckList } from "./parser";

/**
 * Encode a parsed deck into a URL-safe string.
 * Uses a compact text format: "4 Card Name\n" with "---" as section separator.
 * The text is deflated with pako, then base64url-encoded.
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
  const bytes = new TextEncoder().encode(text);
  const compressed = deflate(bytes);
  return base64UrlEncode(compressed);
}

/**
 * Decode a URL-safe string back into a ParsedDeck.
 * Tries to inflate (decompress) first; if that fails, treats the input as
 * raw base64 for backwards compatibility with old uncompressed URLs.
 */
export function decodeDeck(encoded: string): ParsedDeck {
  const bytes = base64UrlDecode(encoded);

  let text: string;
  try {
    const decompressed = inflate(bytes);
    text = new TextDecoder().decode(decompressed);
  } catch {
    // Not compressed — legacy format, decode raw bytes as UTF-8
    text = new TextDecoder().decode(bytes);
  }

  return parseDeckList(text);
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
