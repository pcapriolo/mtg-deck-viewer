import { describe, it, expect } from "vitest";
import { exportAsArena, exportAsMTGO } from "../deck-exporter";
import type { ResolvedEntry } from "../types";
import type { DeckEntry } from "../parser";
import type { ScryfallCard } from "../scryfall";

function makeEntry(name: string, qty: number, section: "mainboard" | "sideboard" = "mainboard", set?: string, collectorNumber?: string): ResolvedEntry {
  return {
    entry: { quantity: qty, name, section, set, collectorNumber } as DeckEntry,
    card: { name } as ScryfallCard,
  };
}

describe("exportAsArena", () => {
  it("formats mainboard-only deck", () => {
    const main = [makeEntry("Lightning Bolt", 4), makeEntry("Counterspell", 3)];
    expect(exportAsArena(main)).toBe("4 Lightning Bolt\n3 Counterspell");
  });

  it("includes set and collector number when present", () => {
    const main = [makeEntry("Lightning Bolt", 4, "mainboard", "MH3", "123")];
    expect(exportAsArena(main)).toBe("4 Lightning Bolt (MH3) 123");
  });

  it("falls back to name-only when set is missing", () => {
    const main = [makeEntry("Lightning Bolt", 4, "mainboard", undefined, "123")];
    expect(exportAsArena(main)).toBe("4 Lightning Bolt");
  });

  it("separates mainboard and sideboard with blank line", () => {
    const main = [makeEntry("Lightning Bolt", 4)];
    const side = [makeEntry("Pyroblast", 2, "sideboard")];
    const result = exportAsArena(main, side);
    expect(result).toBe("4 Lightning Bolt\n\n2 Pyroblast");
  });

  it("omits sideboard section when empty", () => {
    const main = [makeEntry("Lightning Bolt", 4)];
    const result = exportAsArena(main, []);
    expect(result).toBe("4 Lightning Bolt");
  });
});

describe("exportAsMTGO", () => {
  it("formats mainboard-only deck", () => {
    const main = [makeEntry("Lightning Bolt", 4), makeEntry("Counterspell", 3)];
    expect(exportAsMTGO(main, [])).toBe("4 Lightning Bolt\n3 Counterspell");
  });

  it("prefixes sideboard lines with SB:", () => {
    const main = [makeEntry("Lightning Bolt", 4)];
    const side = [makeEntry("Pyroblast", 2, "sideboard")];
    const result = exportAsMTGO(main, side);
    expect(result).toBe("4 Lightning Bolt\n\nSB: 2 Pyroblast");
  });

  it("omits sideboard section when empty", () => {
    const main = [makeEntry("Lightning Bolt", 4)];
    expect(exportAsMTGO(main, [])).toBe("4 Lightning Bolt");
  });
});
