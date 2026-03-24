import { describe, it, expect } from "vitest";
import { cleanResponse, extractExpectedCount, countCards } from "../ocr";

describe("cleanResponse", () => {
  it("strips preamble before card lines", () => {
    const text = "Here is the decklist I extracted:\n\n4 Lightning Bolt\n4 Counterspell";
    expect(cleanResponse(text)).toBe("4 Lightning Bolt\n4 Counterspell");
  });

  it("preserves Name/Author metadata at the top", () => {
    const text = "Name: Burn\nAuthor: Paul\n4 Lightning Bolt\n4 Lava Spike";
    expect(cleanResponse(text)).toBe("Name: Burn\nAuthor: Paul\n4 Lightning Bolt\n4 Lava Spike");
  });

  it("preserves Sideboard header", () => {
    const text = "4 Lightning Bolt\nSideboard\n2 Pyroblast";
    expect(cleanResponse(text)).toBe("4 Lightning Bolt\nSideboard\n2 Pyroblast");
  });

  it("strips SUM: arithmetic lines", () => {
    const text = "4 Lightning Bolt\n4 Counterspell\nSUM: 4+4=8";
    expect(cleanResponse(text)).toBe("4 Lightning Bolt\n4 Counterspell");
  });

  it("handles empty input", () => {
    expect(cleanResponse("")).toBe("");
  });

  it("strips commentary after decklist", () => {
    const text = "4 Lightning Bolt\n4 Counterspell\nThis is a great deck for modern play.";
    expect(cleanResponse(text)).toBe("4 Lightning Bolt\n4 Counterspell");
  });

  it("handles Nx format card lines", () => {
    const text = "4x Lightning Bolt\n3X Counterspell";
    expect(cleanResponse(text)).toBe("4x Lightning Bolt\n3X Counterspell");
  });
});

describe("extractExpectedCount", () => {
  it("extracts from '60/60 Cards' format", () => {
    expect(extractExpectedCount("The image shows 60/60 Cards")).toBe(60);
  });

  it("extracts from 'expected: 60' format", () => {
    expect(extractExpectedCount("expected: 60")).toBe(60);
  });

  it("extracts from 'image shows 75' format", () => {
    expect(extractExpectedCount("image shows 75")).toBe(75);
  });

  it("extracts from 'should be 60' format", () => {
    expect(extractExpectedCount("should be 60")).toBe(60);
  });

  it("returns null for unreasonable counts (< 40)", () => {
    expect(extractExpectedCount("expected: 10")).toBeNull();
  });

  it("returns null for unreasonable counts (> 100)", () => {
    expect(extractExpectedCount("expected: 200")).toBeNull();
  });

  it("returns null when no pattern matches", () => {
    expect(extractExpectedCount("here is a decklist")).toBeNull();
  });
});

describe("countCards", () => {
  it("counts mainboard cards", () => {
    const deck = "4 Lightning Bolt\n4 Counterspell\n2 Snapcaster Mage";
    expect(countCards(deck)).toBe(10);
  });

  it("excludes sideboard cards", () => {
    const deck = "4 Lightning Bolt\nSideboard\n2 Pyroblast";
    expect(countCards(deck)).toBe(4);
  });

  it("handles blank lines", () => {
    const deck = "4 Lightning Bolt\n\n4 Counterspell";
    expect(countCards(deck)).toBe(8);
  });

  it("returns 0 for empty decklist", () => {
    expect(countCards("")).toBe(0);
  });

  it("handles Name/Author lines without counting them", () => {
    const deck = "Name: Burn\n4 Lightning Bolt\n4 Lava Spike";
    expect(countCards(deck)).toBe(8);
  });

  it("handles quantities greater than 4", () => {
    const deck = "20 Mountain\n4 Lightning Bolt";
    expect(countCards(deck)).toBe(24);
  });
});
