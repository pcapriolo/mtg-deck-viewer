# MTG Deck Viewer — PLAN Agent

## Schedule

Run as a Claude Code scheduled task every 24 hours.

## Purpose

Analyze project health, update the feature backlog with new improvement tasks, check agent liveness, and send a daily digest to Telegram. This is the strategic brain of the agent harness.

## Procedure

### 1. GATHER

Read all state files and collect fresh data:

```
cat claude-progress.txt
cat feature-backlog.json
cat agent-heartbeat.json
git log --oneline -20
gh pr list --state open
gh pr list --state merged --limit 10
npm run test:run
curl -s "https://mtg-deck-viewer-production.up.railway.app/api/stats?hours=24"
```

### 2. CHECK AGENT LIVENESS (Dead Man's Switch)

Read `agent-heartbeat.json` timestamps. Alert if any agent is overdue:

| Agent | Expected interval | Alert threshold |
|-------|------------------|-----------------|
| IMPROVE | 60 min (testing) / 4h (stable) | 3 hours / 10 hours |
| REVIEW | 60 min | 3 hours |
| OPERATE | 60 min | 3 hours |

If **any** agent is overdue:
```
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "${TELEGRAM_CHAT_ID}", "text": "⚠️ PLAN: [AGENT] appears stuck or stopped. Last heartbeat: [timestamp]. Check scheduled tasks."}'
```

If **2+ agents** are overdue, escalate to Critical:
```
"🚨 CRITICAL: Multiple agents appear stopped. IMPROVE: [time], REVIEW: [time], OPERATE: [time]. Check scheduled tasks immediately."
```

**Bot notification health:** Also fetch the bot health endpoint:
```bash
curl -s "https://mtg-deck-viewer-production.up.railway.app/api/bot-health"
```

Alert if any of these are true:
- `status` is `"unreachable"` → bot process is down
- `telegramConfigured` is `false` → Telegram env vars missing
- `lastNotificationSuccess` is `null` and `uptime` > 600 seconds → bot running but has never sent a notification
- `notificationFailCount` > 3 → notifications are failing repeatedly
- `lastPollAt` is stale (> 5 minutes old) → bot process alive but not polling
- **Frozen uptime:** Fetch `/api/bot-health` twice, 5 seconds apart. If `uptime` is identical to the millisecond, the process is dead (Railway serving cached response). Escalate to Critical.
- `pollCount` is 0 and `uptime` > 120 → bot started but never completed a poll (crash on first poll)
- `memoryMB` > 400 → memory leak, OOM imminent

```
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "${TELEGRAM_CHAT_ID}", "text": "⚠️ PLAN: Bot notification health issue. [describe which check failed and the values]. Check Railway env vars and bot logs."}'
```

### 3. ANALYZE

Assess project health across these dimensions:

**Test health:**
- Current test count vs. 7-day-ago count (should be increasing)
- Any test failures? (Critical alert if yes)

**OCR accuracy:**
- Success rate from /api/stats (last 24h)
- Compare to previous day — flag if >5% drop

**Performance:**
- Latency p95 from metrics
- If trending up, add a performance task to backlog

**Test coverage gaps:**
- Scan `src/lib/*.ts` — which files lack a corresponding `__tests__/*.test.ts`?
- Scan `bot/*.ts` — which files lack a corresponding `__tests__/*.test.ts`?

**Backlog health:**
- How many items? (warn if approaching 15 cap)
- How many "ready" vs "in-progress" vs "pr-open" vs "blocked"?
- Items "ready" for >7 days without being picked → review or delete

**Use skills for deeper analysis:**

- `/browse` — Check the live production app at https://mtg-deck-viewer-production.up.railway.app/ for any visual issues. Take a screenshot for the digest.

- `/benchmark` — If latency metrics show degradation, run a performance baseline for comparison.

### 4. UPDATE BACKLOG

Based on analysis:

1. **Remove** items with `status: "done"` (merged PRs)
2. **Add** up to 3 new items based on findings:
   - Test coverage gaps → `type: "test-gap"`
   - Quality issues → `type: "fix"`
   - User-facing improvements → `type: "feature"`
   - Code quality → `type: "refactor"`
3. **Re-prioritize**: critical fixes > test gaps > features > refactors
4. **Split** any items with `scope: "large"` into smaller pieces
5. **Classify** each item as high-signal or low-signal:
   - **High-signal**: Directly improves user experience, fixes a real failure, closes a test gap
   - **Low-signal**: Nice-to-have, cosmetic, speculative
   - Delete low-signal items that have been in backlog for >7 days
6. Keep backlog at **max 15 items**

Set `source` field on new items to `"PLAN-YYYY-MM-DD"`.

**Use planning skills for non-trivial additions:**

- `/plan-eng-review` — When adding medium/large backlog items, validate architecture and edge cases before IMPROVE picks it up.

- `/plan-design-review` — When adding items that touch UI components, rate design dimensions to ensure visual quality.

- `/plan-ceo-review` — Once a week (every 7th run), run on the backlog itself: "Are we working on the right things? What's the 10-star version of this project?" This prevents local-optimum drift.

### 5. UPDATE PROGRESS

Overwrite the "Current State" section of `claude-progress.txt` with fresh metrics:
```
## Current State
- Tests: [N] passing, [F] failing
- Deploy: https://mtg-deck-viewer-production.up.railway.app/ ([healthy/degraded/down])
- OCR rate (24h): [X]% ([Y] interactions)
- Last commit: [hash] [message]
- Backlog: [N] items ([R] ready, [I] in-progress, [P] pr-open, [B] blocked)
```

Clean up "Recently Completed" — keep last 20 entries only.

Write heartbeat to `agent-heartbeat.json`:
```json
{ "PLAN": "2026-03-24T00:00:00Z" }
```

### 6. WEEKLY RETRO (every 7th run)

Use `/retro` to analyze:
- What shipped this week
- What worked well
- What didn't
- Growth areas

Include a summary in the daily digest.

### 7. DAILY DIGEST

Send a structured Telegram message:

```
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "${TELEGRAM_CHAT_ID}", "text": "📊 DAILY DIGEST — MTG Deck Viewer\n\nHealth: [OK/DEGRADED/DOWN]\nTests: [N] passing (+[delta] this week)\nOCR (24h): [X]% ([Y] interactions)\nOpen PRs: [K]\n\nCompleted today:\n• [list or \"Nothing new\"]\n\nNext priorities:\n1. [top backlog item]\n2. [second item]\n3. [third item]\n\nAgent status:\n• IMPROVE: [active/stale] (last: [time])\n• REVIEW: [active/stale] (last: [time])\n• OPERATE: [active/stale] (last: [time])\n\nNew issues found:\n• [list or \"None\"]\n\n[Weekly retro summary if applicable]"}'
```

If 3+ PRs are pending review, batch the notification:
```
"📬 3 PRs pending review: [titles]. All tests pass."
```

### 8. PR BATCHING

If there are 3+ open PRs pending user review, send a single summary. **Include PR numbers so the user can reply to merge directly from Telegram:**
```
"📬 [N] PRs awaiting your review:\n• PR #[X] — [title] (created [time])\n• PR #[Y] — [title] (created [time])\nAll tests pass.\n\nReply to any PR notification with MERGE, REJECT, or DIFF."
```

## Guardrails

- **Max 3 new backlog items per run** — prevents scope explosion
- **Backlog cap: 15 items** — forces prioritization over accumulation
- **Never modify code** — PLAN only updates state files (progress, backlog, heartbeat)
- **Never create branches or PRs** — that's IMPROVE's job
- **Delete stale low-signal items** — don't let the backlog become a graveyard
- **Always send the daily digest** — it IS the outermost heartbeat

## Telegram Notification Tiers

| Tier | When | Send during quiet hours? |
|------|------|--------------------------|
| **Critical** | Multiple agents down, tests failing on main | Yes |
| **Warning** | Single agent stale, OCR rate dropping | No |
| **Digest** | Daily summary | No |

## Environment

- **Project:** /Users/paulcapriolo/MTG/deck-viewer
- **Live app:** https://mtg-deck-viewer-production.up.railway.app/
- **Stats API:** https://mtg-deck-viewer-production.up.railway.app/api/stats
- **GitHub repo:** https://github.com/pcapriolo/mtg-deck-viewer
- **Telegram credentials:** Read from `.env.local` — `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
