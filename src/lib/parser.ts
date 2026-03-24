/**
 * Decklist parser — handles Arena, MTGO, and generic formats.
 *
 * Supported formats:
 *   "4 Lightning Bolt"
 *   "4x Lightning Bolt"
 *   "4 Lightning Bolt (MH3) 123"   (Arena export with set + collector number)
 *   "SB: 2 Mystical Dispute"       (MTGO sideboard prefix)
 *
 * Sections are detected by blank lines or header lines like "Sideboard", "Companion", etc.
 */

export type DeckSection = "mainboard" | "sideboard" | "companion" | "commander";

export interface DeckEntry {
  quantity: number;
  name: string;
  set?: string;
  collectorNumber?: string;
  section: DeckSection;
}

export interface ParsedDeck {
  entries: DeckEntry[];
  name?: string;
  author?: string;
}

const SECTION_HEADERS: Record<string, DeckSection> = {
  deck: "mainboard",
  mainboard: "mainboard",
  maindeck: "mainboard",
  main: "mainboard",
  sideboard: "sideboard",
  side: "sideboard",
  sb: "sideboard",
  companion: "companion",
  commander: "commander",
};

// Matches: "4 Lightning Bolt", "4x Lightning Bolt", "4X Lightning Bolt"
const LINE_PATTERN = /^(\d+)\s*[xX]?\s+(.+)$/;

// Matches Arena set/collector info: "(MH3) 123"
const ARENA_SET_PATTERN = /\(([A-Z0-9]+)\)\s+(\d+[a-z]?)$/;

// Matches MTGO sideboard prefix: "SB: 2 Card Name"
const MTGO_SB_PATTERN = /^SB:\s*/i;

// Matches "Name: Deck Name" or "Name Deck Name" (common in deck export sites)
const NAME_PATTERN = /^name[:\s]+(.+)$/i;

// Matches "Author: Name" or "By Name" or "Player: Name"
const AUTHOR_PATTERN = /^(?:author|by|player)[:\s]+(.+)$/i;

// Lines to skip — common metadata headers that aren't card names or section headers
const SKIP_WORDS = new Set(["about", "format", "date", "event", "source", "url", "link", "description"]);

function detectSection(line: string): DeckSection | null {
  const cleaned = line.toLowerCase().replace(/[:\s]/g, "");
  return SECTION_HEADERS[cleaned] ?? null;
}

export function parseDeckList(input: string): ParsedDeck {
  const lines = input.split(/\r?\n/);
  let currentSection: DeckSection = "mainboard";
  let deckName: string | undefined;
  let author: string | undefined;
  const entries: DeckEntry[] = [];
  let seenCards = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      // Blank line after mainboard cards → switch to sideboard
      if (seenCards && currentSection === "mainboard") {
        currentSection = "sideboard";
      }
      continue;
    }

    // Check for section header
    const section = detectSection(line);
    if (section) {
      currentSection = section;
      continue;
    }

    // Check for "Name: Deck Name" pattern
    const nameMatch = line.match(NAME_PATTERN);
    if (nameMatch && !seenCards) {
      deckName = nameMatch[1].trim();
      continue;
    }

    // Check for "Author: Name" / "By Name" pattern
    const authorMatch = line.match(AUTHOR_PATTERN);
    if (authorMatch && !seenCards) {
      author = authorMatch[1].trim();
      continue;
    }

    // Skip common metadata words (e.g. "About", "Format", "Date")
    if (!seenCards && SKIP_WORDS.has(line.toLowerCase().replace(/[:\s]/g, ""))) {
      continue;
    }

    // Check for MTGO sideboard prefix
    let workingLine = line;
    let lineSection = currentSection;
    if (MTGO_SB_PATTERN.test(workingLine)) {
      workingLine = workingLine.replace(MTGO_SB_PATTERN, "");
      lineSection = "sideboard";
    }

    // Try to match a card line
    const match = workingLine.match(LINE_PATTERN);
    if (!match) {
      // Could be a deck name if we haven't seen cards yet and no name set
      if (!seenCards && !deckName && line.length > 0 && !/^\d/.test(line)) {
        deckName = line;
      }
      continue;
    }

    const quantity = parseInt(match[1], 10);
    let name = match[2].trim();
    let set: string | undefined;
    let collectorNumber: string | undefined;

    // Strip Arena set/collector info
    const arenaMatch = name.match(ARENA_SET_PATTERN);
    if (arenaMatch) {
      set = arenaMatch[1];
      collectorNumber = arenaMatch[2];
      name = name.replace(ARENA_SET_PATTERN, "").trim();
    }

    entries.push({ quantity, name, set, collectorNumber, section: lineSection });
    seenCards = true;
  }

  return { entries, name: deckName, author };
}

export function mainboardEntries(deck: ParsedDeck): DeckEntry[] {
  return deck.entries.filter((e) => e.section === "mainboard");
}

export function sideboardEntries(deck: ParsedDeck): DeckEntry[] {
  return deck.entries.filter((e) => e.section === "sideboard");
}

export function companionEntries(deck: ParsedDeck): DeckEntry[] {
  return deck.entries.filter((e) => e.section === "companion");
}

export function totalCards(entries: DeckEntry[]): number {
  return entries.reduce((sum, e) => sum + e.quantity, 0);
}
