import { describe, it, expect } from "vitest";
import {
  composeReplyText,
  composeReplyTextVariant,
  selectVariant,
  encodeDeckUrlWithUtm,
} from "../encoder";

describe("composeReplyTextVariant", () => {
  const baseStats = { mainCount: 60, sideCount: 15, colorPips: "🔵🔴" };

  it("base variant matches existing composeReplyText output", () => {
    const base = composeReplyText(baseStats, "Storm");
    const variant = composeReplyTextVariant(baseStats, "Storm", "base");
    expect(variant).toBe(base);
  });

  it("with_price variant adds price to reply", () => {
    const statsWithPrice = { ...baseStats, totalPrice: 123.45 };
    const result = composeReplyTextVariant(statsWithPrice, "Storm", "with_price");
    expect(result).toContain("$123.45");
    expect(result).toContain("Storm");
    expect(result).toContain("60 cards");
  });

  it("falls back to base when variant exceeds 280 chars", () => {
    const longName = "A".repeat(50); // will be truncated to 47 + "..."
    const statsWithPrice = { ...baseStats, totalPrice: 99999.99 };
    const result = composeReplyTextVariant(statsWithPrice, longName, "with_price");
    // Should still be <= 280 chars (either price version fits or falls back to base)
    expect(result.length).toBeLessThanOrEqual(280);
  });

  it("handles colorless deck with price variant", () => {
    const colorlessStats = { mainCount: 60, sideCount: 0, colorPips: "", totalPrice: 50.0 };
    const result = composeReplyTextVariant(colorlessStats, undefined, "with_price");
    expect(result).toContain("$50.00");
    expect(result).toContain("60-card deck");
    // No color pips line
    expect(result).not.toContain("🔵");
  });

  it("handles very long deck names (truncation + fallback)", () => {
    const veryLongName = "B".repeat(200);
    const result = composeReplyTextVariant(baseStats, veryLongName, "base");
    // Name should be truncated
    expect(result).toContain("...");
    expect(result.length).toBeLessThanOrEqual(280);
  });
});

describe("selectVariant", () => {
  it("returns one of the known variants", () => {
    const known = ["base", "with_price"];
    // Run multiple times to account for randomness
    for (let i = 0; i < 20; i++) {
      expect(known).toContain(selectVariant());
    }
  });
});

describe("encodeDeckUrlWithUtm", () => {
  it("appends utm parameter", () => {
    const url = encodeDeckUrlWithUtm("4 Lightning Bolt", "https://mtgdeck.app", "abc-123");
    expect(url).toContain("?utm=bot-abc-123");
    expect(url).toMatch(/^https:\/\/mtgdeck\.app\/d\/.+\?utm=bot-abc-123$/);
  });

  it("utm parameter doesn't break URL structure", () => {
    const url = encodeDeckUrlWithUtm("4 Lightning Bolt\n4 Counterspell", "https://mtgdeck.app", "test-id");
    // Should have exactly one ? and the utm param
    const parts = url.split("?");
    expect(parts.length).toBe(2);
    expect(parts[1]).toBe("utm=bot-test-id");
    // The base path should start correctly
    expect(parts[0]).toMatch(/^https:\/\/mtgdeck\.app\/d\/.+/);
  });
});
