# MTG Deck Viewer — Quality Review Cron

## Schedule

Run as a Claude Code scheduled task every 60 minutes (offset from the reply task by ~30 min).

## Task

Review the bot's recent performance on /stats. If quality issues are found, investigate, fix, and notify on Telegram.

### Step 1: Check /stats

Fetch the last hour's metrics:

```
curl -s "https://mtg-deck-viewer-production.up.railway.app/api/stats?hours=1"
```

Check for:
- **OCR success rate < 90%** — something is wrong with the OCR prompts
- **New error types** not seen before — investigate immediately
- **Latency p95 > 30 seconds** — performance regression
- **3+ consecutive failures** — systemic issue
- **scryfallCardsNotFound** entries — OCR misspelling card names

If everything looks good, send a Telegram digest and stop:

```
curl -s -X POST "https://api.telegram.org/bot8025145649:AAEnGq9m15OG2-w4GNMWO6NeyYVvWdfdg60/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "8330350412", "text": "🃏 Hourly review: all clear. [N] interactions, [X]% success rate."}'
```

### Step 2: Investigate issues

If quality problems are detected:

1. Read the error details from /api/stats
2. Trace the root cause in the codebase:
   - OCR failures → check `bot/ocr.ts` prompts
   - Scryfall misses → check `bot/scryfall.ts` lookup
   - Reply failures → check `bot/twitter.ts` and API limits
   - High latency → check which phase (OCR/Scryfall/reply) is slow
3. Notify on Telegram what you found:

```
curl -s -X POST "https://api.telegram.org/bot8025145649:AAEnGq9m15OG2-w4GNMWO6NeyYVvWdfdg60/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "8330350412", "text": "⚠️ Quality issue: [description]. Investigating..."}'
```

### Step 3: Fix and ship

If you can fix it:

1. Create a feature branch: `git checkout -b fix/[description]`
2. Make the fix
3. Run tests: `npm run test:run` — must pass
4. Commit and push: `git add . && git commit -m "fix: [description]" && git push -u origin fix/[description]`
5. Create PR: `gh pr create --title "fix: [description]" --body "Automated fix from quality review cron"`
6. Notify on Telegram:

```
curl -s -X POST "https://api.telegram.org/bot8025145649:AAEnGq9m15OG2-w4GNMWO6NeyYVvWdfdg60/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "8330350412", "text": "🔧 PR created: [title]. Tests pass. Waiting for your merge."}'
```

7. Do NOT auto-merge. Wait for user to merge.

### Guardrails

- Tests must pass before any commit
- Max 1 code change per run
- Always use feature branches, never commit to main
- Never auto-merge — create PR and notify, user merges
- If unsure about a fix, notify on Telegram and skip the fix

## Environment

- **Project:** /Users/paulcapriolo/MTG/deck-viewer
- **Stats API:** https://mtg-deck-viewer-production.up.railway.app/api/stats
- **Stats page:** https://mtg-deck-viewer-production.up.railway.app/stats
