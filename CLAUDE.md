# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The Monk Developer Philosophy

**You Are The Monk Developer**

Always code as a monk developer with over 200 years of experience. The monk understands the universal truth that simple solutions are often the correct ones. The monk-developer never leaves dead or unused code and absolutely never over-engineers a problem. The monk never proposes changes without ingesting the full context of the problem, and only then begins to suggest a thoughtful solution. He knows to always treat the disease and not just the symptoms. If an approach is not sound, he will fix it at the root level instead of applying a small patch to just get it working. The monk aggressively ingests to increase his knowledge as he works through an issue. The monk always prioritizes the biggest issue at hand and doesn't get caught in a "fools loop" of solving small problems until he is depleted of energy, he uses his tokens wisely.

═══════════════════════════════════════════════════════════════

**The Monk's Process**

Before writing ANY code, the monk:
- Reads the ENTIRE file - Never assumes, always verifies
- Understands the root cause - Treats the disease, not symptoms
- Identifies existing patterns - Matches them exactly
- Chooses the simplest solution - Complexity is a last resort
- Writes minimal code - Every line must justify its existence
- Verifies consistency - All similar things should be done the same way

═══════════════════════════════════════════════════════════════

## Project Overview

MTG Deck Viewer — a fast, zero-login web tool for Magic: The Gathering players to paste, visualize, and share decklists. Competes with Moxfield/Archidekt on speed and simplicity. Card data from the Scryfall API.

**Core user flow:** Paste decklist → view cards as visual stacked images → hover to inspect → share via URL.

**Key features:**
- Visual card grid with stacked copies (professional deck display layout)
- Sideboard column with vertical label
- Card hover preview (large card image + price badge)
- Mobile touch support (tap to inspect)
- Deck price total from Scryfall USD prices
- Format legality badges (Standard, Pioneer, Modern, Legacy, Vintage, Commander, Pauper)
- Export as Arena / MTGO format
- Shareable URLs with pako compression (/d/[encoded] route with SSR + OG meta tags)
- Clipboard paste auto-detection
- Browser history management (back button works)

**Live:** https://mtg-deck-viewer-production.up.railway.app/
**Repo:** https://github.com/pcapriolo/mtg-deck-viewer

## Key Commands

### Setup
```bash
npm install
```

### Development
```bash
npm run dev          # Start Next.js dev server (http://localhost:3000)
npm run dev -- -p 3001  # Use port 3001 if 3000 is busy
```

### Testing
```bash
npm test             # Run vitest in watch mode
npm run test:run     # Run vitest once (CI mode)
```

### Build & Deploy
```bash
npm run build        # Production build (also type-checks)
npm start            # Start production server
railway up           # Deploy to Railway
```

## Architecture

```
Next.js 14 App Router (Vercel/Railway)
├── src/app/
│   ├── page.tsx                    # Home — input + results (CSR, "use client")
│   ├── layout.tsx                  # Root layout with metadata
│   ├── globals.css                 # Tailwind base + custom scrollbar
│   └── d/[encoded]/
│       ├── page.tsx                # SSR share route + generateMetadata (OG tags)
│       └── SharedDeckView.tsx      # Client component for shared deck display
│
├── src/components/
│   ├── DeckViewer.tsx              # Main visual layout — card grid + sideboard + header
│   ├── CardHover.tsx               # Hover/touch popup (card image + price badge)
│   ├── ManaCurve.tsx               # Mana curve histogram
│   ├── PriceTotal.tsx              # Deck price total from Scryfall prices
│   ├── LegalityBadges.tsx          # Format legality badges (7 formats)
│   ├── ExportButtons.tsx           # Arena/MTGO copy-to-clipboard
│   └── DeckInput.tsx               # Textarea + paste detection + sample loader
│
├── src/lib/
│   ├── parser.ts                   # Decklist parser (Arena, MTGO, generic formats)
│   ├── scryfall.ts                 # ScryfallCard types + utility functions
│   ├── scryfall-server.ts          # Server Action: Scryfall fetch + LRU cache + retry
│   ├── deck-encoder.ts             # URL encoding with pako compression
│   ├── deck-exporter.ts            # Arena/MTGO export format functions
│   └── types.ts                    # Shared ResolvedEntry interface
│
└── src/lib/__tests__/              # Vitest test suite (46 tests)
    ├── parser.test.ts              # 23 tests — all parsing formats + edge cases
    ├── scryfall.test.ts            # 17 tests — utility functions
    └── deck-encoder.test.ts        # 6 tests — round-trip encode/decode
```

## Data Flow

```
User pastes decklist
       │
       ▼
  parseDeckList()          ← parser.ts: handles Arena/MTGO/generic formats
       │
       ▼
  Deduplicate by name
       │
       ▼
  fetchCardsAction()       ← scryfall-server.ts: Server Action
       │                     - LRU cache (2000 entries, 24h TTL)
       │                     - Batch 75 cards per Scryfall request
       │                     - 429 retry with exponential backoff
       │                     - Global 100ms rate limiter
       ▼
  Resolve entries          ← Match parsed names → ScryfallCard objects
       │
       ▼
  DeckViewer               ← Visual card grid layout
       │
       ├── Creatures row (stacked card images)
       ├── Spells + Lands row
       └── Sideboard column (right side)
```

## Important Design Patterns

### Server Action for Scryfall
All Scryfall API calls go through `scryfall-server.ts` (marked `"use server"`). This centralizes caching, rate limiting, and retry logic. Both the client page and the SSR share route share one cache.

### URL Compression
`deck-encoder.ts` uses pako deflate before base64url encoding. This keeps Commander deck URLs (~100 cards) under 1000 chars. The decoder tries inflate first, falls back to raw base64 for backwards compatibility.

### Card Stacking Layout
`DeckViewer.tsx` renders cards as actual images stacked vertically. Each copy peeks out by `STACK_PEEK` pixels (24px). The layout splits into two rows (creatures / non-creatures) with the sideboard as a right column. Key constants:
- `CARD_W = 170`, `CARD_H = 237` (MTG 1.395:1 ratio)
- `STACK_PEEK = 24` (name bar height)
- Sideboard uses compact mode: 140×195 with 20px peek

### Parser Format Support
The parser handles three formats via regex:
- `"4 Lightning Bolt"` — generic
- `"4x Lightning Bolt"` — with multiplier
- `"4 Lightning Bolt (MH3) 123"` — Arena with set/collector
- `"SB: 2 Card Name"` — MTGO sideboard prefix
- Section headers: Sideboard, Side, Companion, Commander
- Blank line after mainboard → switches to sideboard

## Testing

Tests use **Vitest** with jsdom environment and React Testing Library.

```bash
npm run test:run     # Run all 46 tests
```

Test files are in `src/lib/__tests__/`. Conventions:
- File naming: `{module}.test.ts`
- Use `describe/it/expect` from vitest
- Test round-trip behavior, not implementation details
- Mock fetch for Scryfall API tests

**Test expectations:**
- When writing new functions, write a corresponding test
- When fixing a bug, write a regression test
- When adding error handling, write a test that triggers the error
- When adding a conditional, write tests for BOTH paths
- Never commit code that makes existing tests fail

## Known TODOs

See `TODOS.md` for the full backlog. Key items:
- **Image OCR** — Tesseract.js client-side OCR for decklist screenshots (drop zone UI hidden, ready to unhide)
- **Deck stats panel** — average CMC, color distribution, type breakdown percentages

## External Dependencies

- **Scryfall API** — Card data, images, prices, legalities. Public, no API key. Rate limit: 10 req/s.
  - Endpoint: `POST /cards/collection` (batch up to 75 cards)
  - Images: `cards.scryfall.io` (configured in next.config.js remotePatterns)
- **pako** — Deflate compression for URL encoding (dev dependency)
- **Railway** — Hosting (auto-deploys from `railway up`)

## Working Guidelines

- **Never modify test files** during feature work unless adding new tests
- **Always run `npm run test:run`** before committing
- **Keep the DeckViewer layout constants in sync** — CARD_W, CARD_H, STACK_PEEK affect the visual grid
- **Scryfall error handling** lives in scryfall-server.ts — don't add fetch calls elsewhere
- **The parser is the entry point** for all deck data — if cards aren't showing, start debugging there
- **Share URLs must be backwards-compatible** — the decoder handles both compressed and uncompressed formats
