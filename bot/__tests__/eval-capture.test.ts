import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { captureEvalCase, shouldCaptureEval, EvalMetadata } from "../eval-capture";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeMetadata(overrides: Partial<EvalMetadata> = {}): EvalMetadata {
  return {
    tweetId: "tweet-123",
    authorUsername: "testuser",
    capturedAt: "2026-03-26T00:00:00Z",
    inputType: "text",
    expectedCount: 60,
    actualCount: 60,
    ocrPassCount: 0,
    scryfallCardsNotFound: [],
    correctionsApplied: {},
    healingRan: false,
    healingAccepted: false,
    verified: false,
    ...overrides,
  };
}

describe("captureEvalCase", () => {
  let tmpDir: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-test-"));
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes ground-truth.txt and metadata.json to a case directory", async () => {
    // Point EVALS_DIR to tmpDir by spying on fs.mkdirSync and writing to tmpDir
    const mkdirSpy = vi.spyOn(fs, "mkdirSync");
    const writeFileSpy = vi.spyOn(fs, "writeFileSync");

    await captureEvalCase({
      imageUrl: null,
      inputText: null,
      groundTruth: "4 Lightning Bolt\n",
      metadata: makeMetadata(),
    });

    // mkdirSync must have been called with recursive: true
    expect(mkdirSpy).toHaveBeenCalledWith(
      expect.stringContaining("evals"),
      { recursive: true }
    );

    // ground-truth.txt must have been written
    const gtCall = writeFileSpy.mock.calls.find(([p]) =>
      String(p).endsWith("ground-truth.txt")
    );
    expect(gtCall).toBeDefined();
    expect(gtCall![1]).toBe("4 Lightning Bolt\n");

    // metadata.json must have been written with correct tweetId
    const mdCall = writeFileSpy.mock.calls.find(([p]) =>
      String(p).endsWith("metadata.json")
    );
    expect(mdCall).toBeDefined();
    const parsed = JSON.parse(String(mdCall![1]));
    expect(parsed.tweetId).toBe("tweet-123");

    mkdirSpy.mockRestore();
    writeFileSpy.mockRestore();
  });

  it("also writes input-text.txt when inputText is provided", async () => {
    const writeFileSpy = vi.spyOn(fs, "writeFileSync");

    await captureEvalCase({
      imageUrl: null,
      inputText: "4 Lightning Bolt",
      groundTruth: "4 Lightning Bolt\n",
      metadata: makeMetadata(),
    });

    const textCall = writeFileSpy.mock.calls.find(([p]) =>
      String(p).endsWith("input-text.txt")
    );
    expect(textCall).toBeDefined();
    expect(textCall![1]).toBe("4 Lightning Bolt");

    writeFileSpy.mockRestore();
  });

  it("skips input-text.txt when inputText is null", async () => {
    const writeFileSpy = vi.spyOn(fs, "writeFileSync");

    await captureEvalCase({
      imageUrl: null,
      inputText: null,
      groundTruth: "4 Lightning Bolt\n",
      metadata: makeMetadata(),
    });

    const textCall = writeFileSpy.mock.calls.find(([p]) =>
      String(p).endsWith("input-text.txt")
    );
    expect(textCall).toBeUndefined();

    writeFileSpy.mockRestore();
  });

  it("downloads image when imageUrl is provided and saves with correct extension", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => new ArrayBuffer(4),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const writeFileSpy = vi.spyOn(fs, "writeFileSync");

    await captureEvalCase({
      imageUrl: "https://example.com/deck.png",
      inputText: null,
      groundTruth: "4 Lightning Bolt\n",
      metadata: makeMetadata({ inputType: "image" }),
    });

    expect(mockFetch).toHaveBeenCalledWith("https://example.com/deck.png");

    const imgCall = writeFileSpy.mock.calls.find(([p]) =>
      String(p).endsWith("input.png")
    );
    expect(imgCall).toBeDefined();

    writeFileSpy.mockRestore();
  });

  it("does not throw when image download fails (graceful)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;

    await expect(
      captureEvalCase({
        imageUrl: "https://example.com/deck.jpg",
        inputText: null,
        groundTruth: "4 Lightning Bolt\n",
        metadata: makeMetadata({ inputType: "image" }),
      })
    ).resolves.toBeUndefined();
  });

  it("does not throw when fs.mkdirSync fails (graceful)", async () => {
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    await expect(
      captureEvalCase({
        imageUrl: null,
        inputText: null,
        groundTruth: "4 Lightning Bolt\n",
        metadata: makeMetadata(),
      })
    ).resolves.toBeUndefined();

    vi.restoreAllMocks();
  });

  it("serialises metadata fields correctly to JSON", async () => {
    const writeFileSpy = vi.spyOn(fs, "writeFileSync");

    const meta = makeMetadata({
      scryfallCardsNotFound: ["Faithless Looting"],
      correctionsApplied: { "Lightning Bolt": "Lightning Bolt" },
      healingRan: true,
      healingAccepted: true,
      verified: true,
    });

    await captureEvalCase({
      imageUrl: null,
      inputText: null,
      groundTruth: "60 cards\n",
      metadata: meta,
    });

    const mdCall = writeFileSpy.mock.calls.find(([p]) =>
      String(p).endsWith("metadata.json")
    );
    expect(mdCall).toBeDefined();
    const parsed = JSON.parse(String(mdCall![1]));

    expect(parsed.scryfallCardsNotFound).toEqual(["Faithless Looting"]);
    expect(parsed.correctionsApplied).toEqual({ "Lightning Bolt": "Lightning Bolt" });
    expect(parsed.healingRan).toBe(true);
    expect(parsed.healingAccepted).toBe(true);
    expect(parsed.verified).toBe(true);

    writeFileSpy.mockRestore();
  });
});

describe("shouldCaptureEval", () => {
  it("returns false when nothing interesting happened", () => {
    expect(
      shouldCaptureEval({
        scryfallCardsNotFound: [],
        healingRan: false,
        ocrCorrectionRan: false,
        expectedCount: 60,
        actualCount: 60,
      })
    ).toBe(false);
  });

  it("returns true when there are unresolved Scryfall cards", () => {
    expect(
      shouldCaptureEval({
        scryfallCardsNotFound: ["Faithless Looting"],
        healingRan: false,
        ocrCorrectionRan: false,
        expectedCount: null,
        actualCount: 59,
      })
    ).toBe(true);
  });

  it("returns true when healing ran", () => {
    expect(
      shouldCaptureEval({
        scryfallCardsNotFound: [],
        healingRan: true,
        ocrCorrectionRan: false,
        expectedCount: null,
        actualCount: 60,
      })
    ).toBe(true);
  });

  it("returns true when OCR correction ran", () => {
    expect(
      shouldCaptureEval({
        scryfallCardsNotFound: [],
        healingRan: false,
        ocrCorrectionRan: true,
        expectedCount: null,
        actualCount: 60,
      })
    ).toBe(true);
  });

  it("returns true when expected count does not match actual count", () => {
    expect(
      shouldCaptureEval({
        scryfallCardsNotFound: [],
        healingRan: false,
        ocrCorrectionRan: false,
        expectedCount: 60,
        actualCount: 58,
      })
    ).toBe(true);
  });

  it("returns false when expectedCount is null (no count to compare)", () => {
    expect(
      shouldCaptureEval({
        scryfallCardsNotFound: [],
        healingRan: false,
        ocrCorrectionRan: false,
        expectedCount: null,
        actualCount: 60,
      })
    ).toBe(false);
  });
});
