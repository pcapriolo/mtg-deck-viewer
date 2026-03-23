# MTG Deck Viewer — Quality Review Cron

## Schedule

Run as a Claude Code scheduled task every 60 minutes (offset from the reply task by ~30 min).

## Task

Review the bot's recent performance on /stats. If quality issues are found, investigate, fix, and notify on Telegram.

### Step 1: Check bot health

Fetch the bot's live health status:

```
curl -s "https://mtg-deck-viewer-production.up.railway.app/api/bot-health"
```

Check for:
- **`status` is `"unreachable"`** — bot process is down. Alert immediately.
- **`telegramConfigured` is `false`** — Telegram env vars missing on Railway. Alert immediately.
- **`lastPollAt` is stale (> 5 minutes old)** — bot alive but not polling. Alert.
- **`notificationFailCount` > 0** — notifications are failing. Alert with the count.
- **`lastNotificationSuccess` is `null` and `uptime` > 600** — bot has been up 10+ minutes without a single successful notification. Alert.

If any check fails:
```
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "${TELEGRAM_CHAT_ID}", "text": "⚠️ REVIEW: Bot health issue — [describe what failed and the values]. Check Railway."}'
```

### Step 2: Check /stats

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
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "${TELEGRAM_CHAT_ID}", "text": "🃏 Hourly review: all clear. [N] interactions, [X]% success rate."}'
```

### Step 3: Investigate issues

If quality problems are detected:

1. Read the error details from /api/stats
2. Trace the root cause in the codebase:
   - OCR failures → check `bot/ocr.ts` prompts
   - Scryfall misses → check `bot/scryfall.ts` lookup
   - Reply failures → check `bot/twitter.ts` and API limits
   - High latency → check which phase (OCR/Scryfall/reply) is slow
3. Notify on Telegram what you found:

```
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "${TELEGRAM_CHAT_ID}", "text": "⚠️ Quality issue: [description]. Investigating..."}'
```

### Step 4: Fix and ship

If you can fix it:

1. Create a feature branch: `git checkout -b fix/[description]`
2. Make the fix
3. Run tests: `npm run test:run` — must pass
4. Commit and push: `git add . && git commit -m "fix: [description]" && git push -u origin fix/[description]`
5. Create PR: `gh pr create --title "fix: [description]" --body "Automated fix from quality review cron"`
6. Notify on Telegram:

```
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "${TELEGRAM_CHAT_ID}", "text": "🔧 PR created: [title]. Tests pass. Waiting for your merge."}'
```

7. Do NOT auto-merge. Wait for user to merge.

### Guardrails

- Tests must pass before any commit
- Max 1 code change per run
- Always use feature branches, never commit to main
- Never auto-merge — create PR and notify, user merges
- If unsure about a fix, notify on Telegram and skip the fix

### Step 5: Update agent state files

After every run (whether issues were found or not):

1. **Write heartbeat** to `agent-heartbeat.json`:
   ```
   // Update the REVIEW timestamp to current ISO time
   { "REVIEW": "2026-03-23T14:37:00Z" }
   ```

2. **If you found an issue you CANNOT auto-fix**, append it to `feature-backlog.json`:
   ```json
   {
     "id": "[descriptive-id]",
     "title": "[what's wrong]",
     "priority": 1,
     "type": "fix",
     "source": "REVIEW-YYYY-MM-DD",
     "status": "ready",
     "scope": "small",
     "verification": {
       "tests": "[what tests should verify the fix]",
       "browser": null
     },
     "files": ["[affected files]"],
     "notes": "[diagnostic details from your investigation]"
   }
   ```
   Keep backlog at max 15 items. If full, only add if this issue is higher priority than the lowest item.

3. **Append a one-line entry** to the "Recently Completed" section of `claude-progress.txt`:
   ```
   - [YYYY-MM-DD REVIEW] [summary of what was checked/found/fixed]
   ```

## Environment

- **Project:** /Users/paulcapriolo/MTG/deck-viewer
- **Stats API:** https://mtg-deck-viewer-production.up.railway.app/api/stats
- **Stats page:** https://mtg-deck-viewer-production.up.railway.app/stats
