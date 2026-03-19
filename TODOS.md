# TODOS

## P2: Image OCR for Decklist Screenshots
**What:** Add Tesseract.js client-side OCR so users can drop/upload decklist screenshots and have them parsed into card lists.
**Why:** The image drop zone UI is already built (DeckInput.tsx) but hidden. Users photograph paper decklists or screenshot digital ones — OCR would unlock this workflow.
**Context:** Deferred from the initial ship PR to keep scope tight (eng review). The drop zone code stays in the codebase (hidden behind a conditional). When OCR ships: (1) add `tesseract.js` dependency (~13MB), (2) create `src/lib/ocr.ts` wrapper, (3) unhide the drop zone in DeckInput.tsx, (4) wire up the image → OCR → parseDeckList pipeline, (5) add error handling for OCR failures (blurry image, non-English, etc.), (6) write tests.
**Effort:** M (human: ~1 day / CC: ~20 min)
**Depends on:** Initial ship PR completing first.
