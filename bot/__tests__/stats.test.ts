import { describe, it, expect } from "vitest";
import { deriveDeckStats, colorsToPips, selectTopCard, getArtCrop } from "../stats";
import type { BotScryfallCard } from "../scryfall";

function makeCard(overrides: Partial<BotScryfallCard>): BotScryfallCard {
  return {
    name: "Test Card",
    color_identity: [],
    type_line: "Creature",
    prices: {},
    ...overrides,
  };
}

describe("colorsToPips", () => {
  it("maps WUBRG to emoji circles", () => {
    expect(colorsToPips(["W", "U", "B", "R", "G"])).toBe("⚪🔵⚫🔴🟢");
  });

  it("preserves WUBRG order regardless of input order", () => {
    expect(colorsToPips(["G", "W", "R"])).toBe("⚪🔴🟢");
  });

  it("returns empty string for colorless", () => {
    expect(colorsToPips([])).toBe("");
  });

  it("handles mono-color", () => {
    expect(colorsToPips(["R"])).toBe("🔴");
  });
});

describe("deriveDeckStats", () => {
  const cards: Record<string, BotScryfallCard> = {
    "lightning bolt": makeCard({ name: "Lightning Bolt", color_identity: ["R"], type_line: "Instant", prices: { usd: "1.00" } }),
    "goblin guide": makeCard({ name: "Goblin Guide", color_identity: ["R"], type_line: "Creature — Goblin Scout", prices: { usd: "5.00" } }),
    "mountain": makeCard({ name: "Mountain", color_identity: [], type_line: "Basic Land — Mountain" }),
  };

  const deckText = `4 Lightning Bolt
4 Goblin Guide
12 Mountain
Sideboard
2 Lightning Bolt`;

  it("derives correct color identity", () => {
    const stats = deriveDeckStats(cards, deckText);
    expect(stats.colors).toEqual(["R"]);
    expect(stats.colorPips).toBe("🔴");
  });

  it("counts types correctly", () => {
    const stats = deriveDeckStats(cards, deckText);
    expect(stats.creatureCount).toBe(4);
    expect(stats.spellCount).toBe(4);
    expect(stats.landCount).toBe(12);
  });

  it("counts main and side separately", () => {
    const stats = deriveDeckStats(cards, deckText);
    expect(stats.mainCount).toBe(20);
    expect(stats.sideCount).toBe(2);
  });

  it("skips Name: and Author: lines", () => {
    const textWithMeta = `Name: Burn Deck\nAuthor: TestUser\n${deckText}`;
    const stats = deriveDeckStats(cards, textWithMeta);
    expect(stats.mainCount).toBe(20);
  });

  it("returns empty pips for colorless deck", () => {
    const colorless = { "mountain": makeCard({ name: "Mountain", color_identity: [], type_line: "Basic Land" }) };
    const stats = deriveDeckStats(colorless, "20 Mountain");
    expect(stats.colorPips).toBe("");
    expect(stats.colors).toEqual([]);
  });
});

describe("selectTopCard", () => {
  const cards: Record<string, BotScryfallCard> = {
    "trumpeting carnosaur": makeCard({ name: "Trumpeting Carnosaur", prices: { usd: "2.00" } }),
    "lightning bolt": makeCard({ name: "Lightning Bolt", prices: { usd: "1.00" } }),
    "black lotus": makeCard({ name: "Black Lotus", prices: { usd: "50000.00" } }),
  };

  it("matches namesake by word overlap", () => {
    const top = selectTopCard(cards, "4 Trumpeting Carnosaur\n4 Lightning Bolt", "Carnosaur Technique");
    expect(top?.name).toBe("Trumpeting Carnosaur");
  });

  it("falls back to most expensive when no name match", () => {
    const top = selectTopCard(cards, "4 Lightning Bolt\n1 Black Lotus", undefined);
    expect(top?.name).toBe("Black Lotus");
  });

  it("falls back to first card when no prices", () => {
    const noPrices: Record<string, BotScryfallCard> = {
      "goblin guide": makeCard({ name: "Goblin Guide" }),
    };
    const top = selectTopCard(noPrices, "4 Goblin Guide", undefined);
    expect(top?.name).toBe("Goblin Guide");
  });
});

describe("getArtCrop", () => {
  it("returns art_crop from image_uris", () => {
    const card = makeCard({ image_uris: { art_crop: "https://example.com/art.jpg", normal: "" } });
    expect(getArtCrop(card)).toBe("https://example.com/art.jpg");
  });

  it("handles DFC cards with card_faces", () => {
    const card = makeCard({
      image_uris: undefined,
      card_faces: [{ name: "Front", image_uris: { art_crop: "https://example.com/front.jpg", normal: "" } }],
    });
    expect(getArtCrop(card)).toBe("https://example.com/front.jpg");
  });

  it("returns empty string when no images", () => {
    const card = makeCard({ image_uris: undefined });
    expect(getArtCrop(card)).toBe("");
  });
});
