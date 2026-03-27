import { describe, it, expect } from "vitest";
import { extractDeckName, summarizeDecklist } from "../encoder";

describe("extractDeckName", () => {
  it("extracts name with colon separator", () => {
    expect(extractDeckName("Name: Storm")).toBe("Storm");
  });

  it("extracts name with space separator", () => {
    expect(extractDeckName("Name Storm")).toBe("Storm");
  });

  it("is case-insensitive", () => {
    expect(extractDeckName("NAME: RDW")).toBe("RDW");
    expect(extractDeckName("name: Azorius Control")).toBe("Azorius Control");
  });

  it("trims whitespace from the extracted name", () => {
    expect(extractDeckName("Name:   Dredge  ")).toBe("Dredge");
  });

  it("returns undefined when no name line exists", () => {
    expect(extractDeckName("4 Lightning Bolt\n4 Goblin Guide")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(extractDeckName("")).toBeUndefined();
  });

  it("finds name line in a multi-line decklist", () => {
    const text = "4 Lightning Bolt\n4 Goblin Guide\nName: Burn\n4 Shard Volley";
    expect(extractDeckName(text)).toBe("Burn");
  });
});

describe("summarizeDecklist", () => {
  it("summarizes a mainboard-only deck", () => {
    const text = "4 Lightning Bolt\n4 Goblin Guide\n4 Eidolon of the Great Revel\n4 Monastery Swiftspear";
    const result = summarizeDecklist(text);
    expect(result).toBe("16-card deck");
  });

  it("includes deck name when present", () => {
    const text = "Name: Burn\n4 Lightning Bolt\n4 Goblin Guide";
    const result = summarizeDecklist(text);
    expect(result).toBe("Burn · 8-card deck");
  });

  it("counts sideboard cards after 'Sideboard' header", () => {
    const text = "4 Lightning Bolt\n4 Goblin Guide\nSideboard\n2 Eidolon of the Great Revel\n1 Smash to Smithereens";
    const result = summarizeDecklist(text);
    expect(result).toBe("8-card deck · 3-card sideboard");
  });

  it("counts sideboard cards after 'Side' header", () => {
    const text = "4 Lightning Bolt\nSide\n2 Relic of Progenitus";
    const result = summarizeDecklist(text);
    expect(result).toBe("4-card deck · 2-card sideboard");
  });

  it("includes name and sideboard together", () => {
    const text = "Name: RDW\n4 Lightning Bolt\n4 Goblin Guide\nSideboard\n4 Smash to Smithereens";
    const result = summarizeDecklist(text);
    expect(result).toBe("RDW · 8-card deck · 4-card sideboard");
  });

  it("skips Author line and does not count it", () => {
    const text = "Name: My Deck\nAuthor: Player1\n4 Lightning Bolt";
    const result = summarizeDecklist(text);
    expect(result).toBe("My Deck · 4-card deck");
  });

  it("returns '0-card deck' for empty input", () => {
    const result = summarizeDecklist("");
    expect(result).toBe("0-card deck");
  });

  it("omits sideboard segment when sideboard count is zero", () => {
    const text = "4 Lightning Bolt\nSideboard\n";
    const result = summarizeDecklist(text);
    // No sideboard cards were added, so segment is omitted
    expect(result).toBe("4-card deck");
    expect(result).not.toContain("sideboard");
  });
});
