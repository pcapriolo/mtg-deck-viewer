import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Anthropic SDK before importing reconcile
const mockMessagesCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })),
}));

import { reconcileContext } from "../reconcile";

function fakeAnthropicResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("reconcileContext — early-exit paths", () => {
  it("returns all nulls when no thread text and no OCR signals", async () => {
    const result = await reconcileContext([], null, null, []);
    expect(result.deckName).toBeNull();
    expect(result.hallmarkCard).toBeNull();
    expect(result.author).toBeNull();
  });

  it("returns OCR metadata when no thread text (skips API call)", async () => {
    mockMessagesCreate.mockClear();
    const result = await reconcileContext(
      [],
      "Grixis Death's Shadow",
      "PVDDR",
      ["Death's Shadow", "Snapcaster Mage"]
    );
    expect(result.deckName).toBe("Grixis Death's Shadow");
    expect(result.author).toBe("PVDDR");
    expect(result.hallmarkCard).toBeNull();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("returns OCR metadata when thread texts are all blank", async () => {
    mockMessagesCreate.mockClear();
    const result = await reconcileContext(
      ["  ", ""],
      "Burn",
      "TestAuthor",
      ["Lightning Bolt"]
    );
    expect(result.deckName).toBe("Burn");
    expect(result.author).toBe("TestAuthor");
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});

describe("reconcileContext — Claude API call path", () => {
  beforeEach(() => {
    mockMessagesCreate.mockClear();
  });

  it("calls Anthropic API when thread text is present", async () => {
    mockMessagesCreate.mockResolvedValue(
      fakeAnthropicResponse('{"deckName": "4-Color Omnath", "hallmarkCard": null, "author": null}')
    );

    await reconcileContext(
      ["Check out this 4-Color Omnath list!"],
      null,
      null,
      ["Omnath, Locus of Creation", "Lightning Bolt"]
    );

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it("returns parsed deckName from Claude response", async () => {
    mockMessagesCreate.mockResolvedValue(
      fakeAnthropicResponse('{"deckName": "Jeskai Control", "hallmarkCard": null, "author": "LSV"}')
    );

    const result = await reconcileContext(
      ["My Jeskai Control build by LSV"],
      null,
      null,
      ["Counterspell", "Teferi, Hero of Dominaria"]
    );

    expect(result.deckName).toBe("Jeskai Control");
    expect(result.author).toBe("LSV");
    expect(result.hallmarkCard).toBeNull();
  });

  it("returns valid hallmarkCard when it matches a card in the list", async () => {
    mockMessagesCreate.mockResolvedValue(
      fakeAnthropicResponse(
        '{"deckName": "Burn", "hallmarkCard": "Lightning Bolt", "author": null}'
      )
    );

    const result = await reconcileContext(
      ["w/ Lightning Bolt, crazy value!"],
      "Burn",
      null,
      ["Lightning Bolt", "Goblin Guide", "Eidolon of the Great Revel"]
    );

    expect(result.hallmarkCard).toBe("Lightning Bolt");
  });

  it("nullifies hallmarkCard when it does not match any card in the list", async () => {
    mockMessagesCreate.mockResolvedValue(
      fakeAnthropicResponse(
        '{"deckName": "Burn", "hallmarkCard": "Black Lotus", "author": null}'
      )
    );

    const result = await reconcileContext(
      ["Insane Burn list with Black Lotus somehow"],
      "Burn",
      null,
      ["Lightning Bolt", "Goblin Guide"]
    );

    expect(result.hallmarkCard).toBeNull();
  });

  it("falls back to OCR metadata when Claude returns non-JSON", async () => {
    mockMessagesCreate.mockResolvedValue(
      fakeAnthropicResponse("Sorry, I cannot help with that.")
    );

    const result = await reconcileContext(
      ["Check out this sweet deck!"],
      "OCR Deck Name",
      "OCR Author",
      ["Lightning Bolt"]
    );

    expect(result.deckName).toBe("OCR Deck Name");
    expect(result.author).toBe("OCR Author");
    expect(result.hallmarkCard).toBeNull();
  });

  it("falls back to OCR metadata when Anthropic API throws an error", async () => {
    mockMessagesCreate.mockRejectedValue(new Error("API rate limit exceeded"));

    const result = await reconcileContext(
      ["Tweet about deck"],
      "Fallback Deck",
      "Fallback Author",
      ["Counterspell"]
    );

    expect(result.deckName).toBe("Fallback Deck");
    expect(result.author).toBe("Fallback Author");
    expect(result.hallmarkCard).toBeNull();
  });

  it("falls back to OCR metadata when JSON is embedded in surrounding text", async () => {
    mockMessagesCreate.mockResolvedValue(
      fakeAnthropicResponse(
        'Here is the result: {"deckName": "Dredge", "hallmarkCard": null, "author": "Saffron Olive"}'
      )
    );

    const result = await reconcileContext(
      ["Dredge deck by Saffron Olive"],
      null,
      null,
      ["Stinkweed Imp", "Creeping Chill"]
    );

    expect(result.deckName).toBe("Dredge");
    expect(result.author).toBe("Saffron Olive");
  });
});
