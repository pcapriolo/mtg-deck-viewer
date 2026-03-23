import { describe, it, expect } from "vitest";
import { extractDecklistFromText, checkReplyQuality } from "../bot";
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

  it("preserves Sideboard header so mainboard and sideboard are separated", () => {
    const text =
      "4 Stormchaser's Talent\n4 Fatal Push\n4 Hopeless Nightmare\n" +
      "Sideboard\n4 Thoughtseize\n3 Duress\n2 Negate";
    const result = extractDecklistFromText(text);
    expect(result).not.toBeNull();
    expect(result).toContain("Sideboard");
    // Mainboard lines should come before Sideboard
    const sbIndex = result!.indexOf("Sideboard");
    const firstCardIndex = result!.indexOf("4 Stormchaser");
    expect(firstCardIndex).toBeLessThan(sbIndex);
  });

  it("preserves Name: and Author: metadata lines", () => {
    const text =
      "Name: Bouncing Shredder\nAuthor: infernoman64\n" +
      "4 Fatal Push\n4 Hopeless Nightmare\n4 Stock Up";
    const result = extractDecklistFromText(text);
    expect(result).not.toBeNull();
    expect(result).toContain("Name: Bouncing Shredder");
    expect(result).toContain("Author: infernoman64");
  });

  it("preserves Companion and Commander headers", () => {
    const text =
      "Companion\n1 Lurrus of the Dream-Den\n" +
      "4 Lightning Bolt\n4 Counterspell\n2 Snapcaster Mage";
    const result = extractDecklistFromText(text);
    expect(result).toContain("Companion");
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

describe("checkReplyQuality", () => {
  const validParams = {
    ocrCardsExtracted: 20,
    scryfallCardsResolved: 18,
    cardNamesCount: 20,
    mainboardCount: 60,
    deckUrl: "https://mtgdeck.app/d/abc123",
    expectedBaseUrl: "https://mtgdeck.app",
  };

  it("passes when all checks are good", () => {
    expect(checkReplyQuality(validParams)).toEqual({ pass: true, reason: "ok" });
  });

  it("fails when ocrCardsExtracted < 3", () => {
    const result = checkReplyQuality({ ...validParams, ocrCardsExtracted: 2 });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("card lines extracted");
  });

  it("fails when scryfallCardsResolved < 3", () => {
    const result = checkReplyQuality({ ...validParams, scryfallCardsResolved: 1 });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("cards resolved");
  });

  it("fails when resolution ratio < 50%", () => {
    const result = checkReplyQuality({ ...validParams, scryfallCardsResolved: 4, cardNamesCount: 20 });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("% of card names resolved");
  });

  it("fails when mainboardCount < 10", () => {
    const result = checkReplyQuality({ ...validParams, mainboardCount: 5 });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("mainboard cards");
  });

  it("fails when URL has wrong base", () => {
    const result = checkReplyQuality({ ...validParams, deckUrl: "https://wrong.com/d/abc" });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("wrong base");
  });

  it("fails when URL is too long", () => {
    const result = checkReplyQuality({ ...validParams, deckUrl: "https://mtgdeck.app/d/" + "x".repeat(2000) });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("too long");
  });

  it("skips ratio check when cardNamesCount is 0", () => {
    const result = checkReplyQuality({ ...validParams, cardNamesCount: 0 });
    expect(result.pass).toBe(true);
  });
});
