import { describe, it, expect, vi } from "vitest";

// We can't easily test the actual Claude API call, but we can test
// the reconciliation logic by mocking the Anthropic client.
// For now, test the input/output contract and edge cases.

describe("reconcileContext contract", () => {
  it("module exports reconcileContext function", async () => {
    const mod = await import("../reconcile");
    expect(typeof mod.reconcileContext).toBe("function");
  });

  it("returns OCR-only when no thread text", async () => {
    const { reconcileContext } = await import("../reconcile");
    const result = await reconcileContext(
      [],
      "Test Deck",
      "TestAuthor",
      ["Lightning Bolt", "Goblin Guide"]
    );
    expect(result.deckName).toBe("Test Deck");
    expect(result.author).toBe("TestAuthor");
    expect(result.hallmarkCard).toBeNull();
  });

  it("returns all nulls when no signals", async () => {
    const { reconcileContext } = await import("../reconcile");
    const result = await reconcileContext([], null, null, []);
    expect(result.deckName).toBeNull();
    expect(result.hallmarkCard).toBeNull();
    expect(result.author).toBeNull();
  });
});
