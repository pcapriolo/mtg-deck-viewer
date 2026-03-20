import { describe, it, expect } from "vitest";
import { extractDecklistFromText } from "../bot";
import { summarizeDecklist } from "../encoder";

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
});
