# MTG Deck Viewer

A fast, zero-login web tool for Magic: The Gathering players to paste, visualize, and share decklists. Card data from the [Scryfall API](https://scryfall.com/docs/api).

**Live:** https://mtg-deck-viewer-production.up.railway.app/

## What it does

1. **Paste a decklist** in Arena, MTGO, or generic format
2. **See your cards** as stacked images with hover-to-inspect
3. **Share via URL** with compressed encoding (Commander-sized decks fit in a URL)
4. **View stats** -- price total, mana curve, format legality

Supports mainboard, sideboard, Commander, and Companion sections.

### Example decklist formats

```
4 Lightning Bolt
4 Counterspell
2 Snapcaster Mage

Sideboard
2 Negate
1 Dispel
```

```
4x Lightning Bolt (MH3) 123
4x Counterspell (DMR) 47
```

```
SB: 2 Negate
SB: 1 Dispel
```

## Quick start

```bash
git clone https://github.com/pcapriolo/mtg-deck-viewer.git
cd mtg-deck-viewer
npm install
npm run dev        # http://localhost:3000
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build (includes type-check) |
| `npm start` | Start production server |
| `npm run test:run` | Run all tests once |
| `npm test` | Run tests in watch mode |
| `railway up` | Deploy to Railway |

## Architecture

```
Next.js 14 App Router
├── src/app/page.tsx              # Home -- paste + view
├── src/app/d/[encoded]/page.tsx  # Shareable deck URLs (SSR + OG tags)
├── src/app/stats/page.tsx        # Bot metrics dashboard
├── src/app/status/page.tsx       # Agent status dashboard
├── src/app/api/
│   ├── ocr/route.ts              # Claude Vision OCR
│   ├── stats/route.ts            # Bot metrics API
│   ├── track/route.ts            # Interaction tracking
│   └── agent-status/route.ts     # Agent heartbeat + backlog API
├── src/components/               # DeckViewer, CardHover, ManaCurve, etc.
├── src/lib/                      # Parser, Scryfall client, encoder, types
└── bot/                          # Twitter bot (separate service)
    ├── bot.ts                    # Polling loop + reply orchestrator
    ├── ocr.ts                    # Claude Vision two-pass OCR
    ├── twitter.ts                # X/Twitter API v2 client
    └── scryfall.ts               # Card lookup
```

## Self-improving agent harness

This project runs itself using Claude Code scheduled tasks. Four loops work together to operate, monitor, improve, and plan:

```
YOU (Telegram + GitHub PRs + /status)
         |
         v
+------------+     +-------------------+     +-------------+
| PLAN (24h) |---->| feature-backlog   |<----| REVIEW (1h) |
| analyze    |     +--------+----------+     | detect+fix  |
| prioritize |              |                +-------------+
+------------+              v
                   +----------------+        +-------------+
                   | IMPROVE (1-4h) |        | OPERATE(1h) |
                   | pick -> build  |        | Twitter bot |
                   | test -> PR     |        +-------------+
                   +--------+-------+
                            v
                   claude-progress.txt  <-- all agents read/write
```

### The four loops

| Loop | What it does | Frequency |
|------|-------------|-----------|
| **OPERATE** | Twitter bot finds decklist tweets, replies with `@mtgviewer` | Every 60 min |
| **REVIEW** | Checks `/api/stats` for quality issues, uses Claude Vision to diagnose OCR failures, creates fix PRs | Every 60 min |
| **IMPROVE** | Picks a task from the backlog, implements on a feature branch, runs tests + QA + code review, creates a PR | Every 1-4 hours |
| **PLAN** | Analyzes metrics, updates the backlog, checks agent liveness, sends daily digest | Every 24 hours |

### How it stays safe

- **Nothing deploys without your merge** -- all work on feature branches
- **Tests are the gate** -- agents can't commit if tests fail, test count never decreases
- **Regression gate** -- QA health score must not drop; if it does, branch is reverted, no PR created
- **One PR per session** -- limits blast radius
- **Dead man's switch** -- PLAN alerts on Telegram if any agent goes silent
- **Tiered notifications** -- Critical/Action/Digest/Heartbeat levels prevent noise

### Observability

| Channel | What you see |
|---------|-------------|
| Telegram | Push alerts for actions + problems, daily digest |
| `/status` | Live health score, agent heartbeats, backlog, recent activity |
| `/stats` | Real-time bot metrics, OCR accuracy, latency |
| GitHub PRs | Exact diffs with test counts and QA results |

### State files

These files coordinate the agents across sessions (gitignored, local only):

- **`claude-progress.txt`** -- Cross-session handoff. Current state, recent completions, known issues, health scores.
- **`feature-backlog.json`** -- Prioritized task queue. PLAN writes, IMPROVE pulls, REVIEW adds issues.
- **`agent-heartbeat.json`** -- Timestamps for each agent's last run. PLAN uses this as a dead man's switch.

### Setting up the automation

1. Install [Claude Code](https://claude.ai/code)
2. Create the state files (see templates in IMPROVE.md and PLAN.md)
3. Register scheduled tasks:
   ```
   # In Claude Code, register these as scheduled tasks:
   # IMPROVE -- every 60 min, instruction file: IMPROVE.md
   # PLAN -- every 24 hours, instruction file: PLAN.md
   # OPERATE -- every 60 min, instruction file: COWORK.md
   # REVIEW -- every 60 min, instruction file: REVIEW-CRON.md
   ```
4. Set up Telegram bot for notifications (token + chat ID in the .md files)

### Skills used

The harness leverages these Claude Code skills for quality gates:

**IMPROVE loop:** `/browse` (visual verify) -> `/qa` (regression check) -> `/review` (code review) -> `/eval` (output quality) -> `/ship` (create PR)

**PLAN loop:** `/browse` (production check) -> `/benchmark` (performance) -> `/retro` (weekly) -> `/plan-ceo-review` (strategy) -> `/plan-eng-review` (architecture) -> `/plan-design-review` (UI quality)

## Environment variables

### Web app (Next.js)
- `ANTHROPIC_API_KEY` -- For OCR API route (Claude Vision)
- `NEXT_PUBLIC_BASE_URL` -- Production URL (optional, falls back to Railway domain)

### Bot
- `X_BEARER_TOKEN`, `X_APP_KEY`, `X_APP_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` -- Twitter API v2
- `X_BOT_USER_ID` -- Bot's numeric user ID
- `ANTHROPIC_API_KEY` -- Claude Vision for OCR
- `DECK_VIEWER_URL` -- Base URL for generated links
- `POLL_INTERVAL` -- Polling interval in seconds (default: 60)

### Telegram notifications
- Bot token and chat ID are configured in IMPROVE.md, PLAN.md, and REVIEW-CRON.md

## Testing

```bash
npm run test:run   # 118 tests across 11 files
```

Tests cover: decklist parsing (all formats), Scryfall utilities, URL encoding round-trips, metrics tracking, bot logic, reply variants, conflict resolution, interaction logging, and notifications.

## License

MIT
