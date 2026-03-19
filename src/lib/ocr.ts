/**
 * Client-side OCR for extracting card names from deck screenshots.
 * Uses Tesseract.js (dynamically imported to avoid bloating the bundle).
 *
 * Strategy: Run OCR → clean up artifacts → return raw text.
 * The existing parser (parser.ts) handles turning it into a ParsedDeck.
 */

export async function extractDecklistFromImage(
  imageData: string, // base64 data URL
  onProgress?: (progress: number) => void
): Promise<string> {
  const { createWorker } = await import('tesseract.js');

  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  try {
    const { data: { text } } = await worker.recognize(imageData);

    // Clean up common OCR artifacts from card screenshots
    const cleaned = text
      .replace(/[|]/g, '')             // pipe chars from card borders
      .replace(/[{}]/g, '')            // curly braces from mana symbols
      .replace(/\s{3,}/g, '\n')        // large whitespace gaps → newlines
      .replace(/[^\x20-\x7E\n]/g, '')  // remove non-ASCII except newlines
      .trim();

    return cleaned;
  } finally {
    await worker.terminate();
  }
}
