import { describe, it, expect } from "vitest";
import { extractDecklistFromText } from "../bot";
import { summarizeDecklist, composeReplyText, extractDeckName } from "../encoder";

describe("extractDecklistFromText", () => {
  it("returns decklist when 3+ lines match 'N CardName' pattern", () => {
    const text = "4 Lightning Bolt\n4 Counterspell\n2 Snapcaster Mage";
    const result = extractDecklistFromText(text);
    expect(result).toBe("4 Lightning Bolt\n4 Counterspell\n2 Snapcaster Mage");
  });

  it("returns null when fewer than 3 lines match", () => {
    const text = "4 Lightning Bolt\n2 Counterspell";
    expect(extractDecklistFromText(text)).toBeNull();
  });

  it("strips @mentions from text before checking", () => {
    const text = "@deckbot @someone 4 Lightning Bolt\n4 Counterspell\n2 Snapcaster Mage";
    const result = extractDecklistFromText(text);
    expect(result).not.toBeNull();
    expect(result).not.toContain("@");
  });

  it("strips URLs from text before checking", () => {
    const text =
      "4 Lightning Bolt\n4 Counterspell\n2 Snapcaster Mage\nhttps://example.com/deck";
    const result = extractDecklistFromText(text);
    expect(result).not.toBeNull();
    expect(result).not.toContain("https://");
  });

  it("handles '4x Card Name' format (with x multiplier)", () => {
    const text = "4x Lightning Bolt\n3x Counterspell\n2x Snapcaster Mage";
    const result = extractDecklistFromText(text);
    expect(result).toBe(
      "4x Lightning Bolt\n3x Counterspell\n2x Snapcaster Mage"
    );
  });

  it("returns only the matching deck lines (strips non-deck text)", () => {
    const text =
      "Here is my deck:\n4 Lightning Bolt\n4 Counterspell\n2 Snapcaster Mage\nWhat do you think?";
    const result = extractDecklistFromText(text);
    expect(result).toBe("4 Lightning Bolt\n4 Counterspell\n2 Snapcaster Mage");
  });

  it("returns null for empty string", () => {
    expect(extractDecklistFromText("")).toBeNull();
  });
});

describe("summarizeDecklist", () => {
  it("returns 'N-card deck' for mainboard-only lists", () => {
    const text = "4 Lightning Bolt\n4 Counterspell\n2 Snapcaster Mage";
    expect(summarizeDecklist(text)).toBe("10-card deck");
  });

  it("returns 'N-card deck · M-card sideboard' when sideboard present", () => {
    const text =
      "4 Lightning Bolt\n4 Counterspell\nSideboard\n2 Negate\n1 Dispel";
    expect(summarizeDecklist(text)).toBe("8-card deck · 3-card sideboard");
  });

  it("handles empty input gracefully", () => {
    expect(summarizeDecklist("")).toBe("0-card deck");
  });

  it("includes deck name when Name: line is present", () => {
    const text = "Name: Burn Deck\n4 Lightning Bolt\n4 Lava Spike";
    expect(summarizeDecklist(text)).toBe("Burn Deck · 8-card deck");
  });

  it("skips Author: line in count", () => {
    const text = "Name: Burn\nAuthor: TestUser\n4 Lightning Bolt\n4 Lava Spike";
    expect(summarizeDecklist(text)).toBe("Burn · 8-card deck");
  });
});

describe("composeReplyText", () => {
  it("includes deck name and color pips", () => {
    const text = composeReplyText(
      { mainCount: 60, sideCount: 15, colorPips: "🔵🔴🟢" },
      "Carnosaur Technique"
    );
    expect(text).toContain("Carnosaur Technique · 60 cards");
    expect(text).toContain("🔵🔴🟢");
    expect(text).toContain("▶ View deck →");
  });

  it("omits color line for colorless deck", () => {
    const text = composeReplyText(
      { mainCount: 60, sideCount: 0, colorPips: "" },
      "Eldrazi Ramp"
    );
    expect(text).toContain("Eldrazi Ramp · 60 cards");
    expect(text).not.toContain("⚪");
    expect(text).not.toContain("🔵");
  });

  it("uses fallback format when no deck name", () => {
    const text = composeReplyText(
      { mainCount: 60, sideCount: 0, colorPips: "🔴" },
    );
    expect(text).toContain("60-card deck");
    expect(text).toContain("🔴");
  });

  it("truncates very long deck names", () => {
    const longName = "A".repeat(60);
    const text = composeReplyText(
      { mainCount: 60, sideCount: 0, colorPips: "" },
      longName
    );
    expect(text).toContain("...");
    expect(text.split("\n")[0].length).toBeLessThan(70);
  });
});

describe("extractDeckName", () => {
  it("extracts name from Name: line", () => {
    expect(extractDeckName("Name: Burn Deck\n4 Lightning Bolt")).toBe("Burn Deck");
  });

  it("returns undefined when no Name: line", () => {
    expect(extractDeckName("4 Lightning Bolt\n4 Lava Spike")).toBeUndefined();
  });

  it("handles case-insensitive Name/name", () => {
    expect(extractDeckName("name: My Deck\n4 Card")).toBe("My Deck");
  });
});
