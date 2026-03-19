/**
 * Export resolved deck entries to common text formats (Arena, MTGO).
 */

import { ResolvedEntry } from "./types";

/**
 * Export entries in MTG Arena format.
 *
 * Format: "N CardName (SET) CollectorNum"
 * Falls back to "N CardName" if set/collectorNumber are missing.
 * Mainboard cards appear first, then a blank line, then sideboard cards (if any).
 */
export function exportAsArena(
  mainboard: ResolvedEntry[],
  sideboard: ResolvedEntry[] = [],
): string {

  const lines: string[] = [];

  for (const { entry } of mainboard) {
    lines.push(formatArenaLine(entry.quantity, entry.name, entry.set, entry.collectorNumber));
  }

  if (sideboard.length > 0) {
    lines.push("");
    for (const { entry } of sideboard) {
      lines.push(formatArenaLine(entry.quantity, entry.name, entry.set, entry.collectorNumber));
    }
  }

  return lines.join("\n");
}

function formatArenaLine(
  quantity: number,
  name: string,
  set?: string,
  collectorNumber?: string,
): string {
  if (set && collectorNumber) {
    return `${quantity} ${name} (${set}) ${collectorNumber}`;
  }
  return `${quantity} ${name}`;
}

/**
 * Export in MTGO format.
 *
 * Mainboard lines: "N CardName"
 * Sideboard lines: "SB: N CardName"
 * A blank line separates mainboard from sideboard (if sideboard is non-empty).
 */
export function exportAsMTGO(
  mainboard: ResolvedEntry[],
  sideboard: ResolvedEntry[],
): string {
  const lines: string[] = [];

  for (const { entry } of mainboard) {
    lines.push(`${entry.quantity} ${entry.name}`);
  }

  if (sideboard.length > 0) {
    lines.push("");
    for (const { entry } of sideboard) {
      lines.push(`SB: ${entry.quantity} ${entry.name}`);
    }
  }

  return lines.join("\n");
}
