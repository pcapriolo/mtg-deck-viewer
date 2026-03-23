# MTG Deck Viewer — IMPROVE Agent

## Schedule

Run as a Claude Code scheduled task every 60 minutes (testing phase — scale to 4 hours once stable).

## Purpose

Pick one task from the feature backlog, implement it on a feature branch, verify with tests + QA + code review, and create a PR. Never auto-merge.

## Procedure

### 1. ORIENT

Read the current state before doing anything:

```
cat claude-progress.txt
cat feature-backlog.json
cat agent-heartbeat.json
git log --oneline -5
git status
npm run test:run
```

Record the baseline:
- `tests_before`: number of passing tests
- `health_before`: composite of test count + pass rate + TypeScript compile clean

**If tests fail at baseline:** STOP. Fix the failing tests as the only task for this session. Notify on Telegram (Critical tier). Do not pick a backlog task.

### 2. PICK

Select the highest-priority item in `feature-backlog.json` with:
- `status: "ready"`
- `scope: "small"` or `"medium"`

If no tasks are ready:
- Update `claude-progress.txt` with "No tasks available"
- Write heartbeat to `agent-heartbeat.json`
- Notify Telegram (Heartbeat tier): "IMPROVE: no tasks available in backlog."
- Exit.

Set the picked item's status to `"in-progress"` in `feature-backlog.json`.
Set the "In Progress" section in `claude-progress.txt`.

### 3. IMPLEMENT

```
git checkout main
git pull origin main
git checkout -b [type]/[id]
```

Follow the CLAUDE.md monk developer philosophy:
- Read the ENTIRE file before making changes
- Understand root cause
- Match existing patterns
- Write minimal, justified code
- Write tests as specified in the task's `verification.tests` field

### 4. VERIFY

Run all verification steps. **Every step must pass before creating a PR.**

```
npm run test:run        # tests_after must be >= tests_before
npx tsc --noEmit        # must compile clean
```

**Use skills for thorough verification:**

- `/browse` — Start the dev server (`npm run dev -- -p 3001`), navigate to the relevant page, and visually verify the change works. Take a BEFORE screenshot (from main) and AFTER screenshot (from the feature branch).

- `/qa` (quick tier) — If the change touches UI components, run automated QA to catch console errors, broken layouts, and regressions. Record the QA health score.

- `/review` — Run pre-landing code review on the diff. Address any issues found before proceeding.

- `/eval` — If the change touches OCR or parser logic, run the eval suite to verify output quality hasn't regressed.

**Regression gate:**
- If `tests_after < tests_before`: REVERT. Do not create PR.
- If `/qa` health score drops by >2 points from baseline: REVERT. Do not create PR.
- If regression detected: notify Telegram (Critical tier), mark task as `"blocked"` in backlog, and explain what went wrong.

### 5. SHIP

Use the `/ship` skill to create a standardized PR:

```
git add [specific files only — never git add -A]
git commit -m "[type]: [title]"
git push -u origin [type]/[id]
gh pr create --title "[type]: [title]" --body "..."
```

The PR body must include:
- What changed and why
- Tests before/after count
- QA health score (if applicable)
- Before/after screenshots (if UI change)
- Verification results from /review

### 6. UPDATE

```json
// feature-backlog.json: set status
{ "status": "pr-open" }
```

Update `claude-progress.txt`:
- Add entry to "Recently Completed" (keep max 20)
- Add health score to "Health Scores" section
- Clear "In Progress"
- Update "Current State" with fresh test count

### 7. NOTIFY

Send Telegram notification (Action needed tier). **Include the PR number prominently and reply instructions** so the user can merge directly from Telegram:

```
curl -s -X POST "https://api.telegram.org/bot8025145649:AAEnGq9m15OG2-w4GNMWO6NeyYVvWdfdg60/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "8330350412", "text": "🔨 IMPROVE: PR #[N] — [title]\n\nTests: [X] passing (was [Y])\nQA: [pass/fail]\nReview: [clean/issues found]\nFiles: [list of changed files]\n\nReply to this message:\n• MERGE to approve and merge\n• REJECT to close\n• DIFF to see the changes"}'
```

The user can respond in two ways:
- **Swipe-reply** on the PR message and type `merge`, `reject`, or `diff`
- **Standalone message** like `merge 5`, `reject #5`, or `diff 5`

The REVIEW cron checks for replies every hour and executes the command automatically. The user never needs to leave Telegram.

**Quiet hours:** Do not send non-Critical notifications between 11pm-7am local time.

### 8. CLEANUP

```
git checkout main
```

Write heartbeat to `agent-heartbeat.json`:
```json
{ "IMPROVE": "2026-03-23T14:15:00Z" }
```

Ensure working tree is clean.

## Guardrails

- **Max 1 PR per session** — if you finish early, exit, don't start another task
- **Never work on main** — always feature branches
- **Never auto-merge** — create PR and notify, user merges
- **Never remove tests** — test count is monotonically increasing
- **Never use `git add -A` or `git add .`** — add specific files only
- **If scope feels too large** — mark as `"blocked"` in backlog with a note, notify Telegram, exit
- **If unsure about a fix** — skip it, notify Telegram, move on
- **Always leave repo on main with clean working tree** when exiting

## Telegram Notification Tiers

| Tier | When | Send during quiet hours? |
|------|------|--------------------------|
| **Critical** | Tests broken, regression detected, deploy down | Yes |
| **Action needed** | PR created, blocked task needs input | No |
| **Heartbeat** | No tasks available, routine all-clear | No (and only if no other message in 6 hours) |

## Environment

- **Project:** /Users/paulcapriolo/MTG/deck-viewer
- **Live app:** https://mtg-deck-viewer-production.up.railway.app/
- **Stats API:** https://mtg-deck-viewer-production.up.railway.app/api/stats
- **Telegram bot token:** 8025145649:AAEnGq9m15OG2-w4GNMWO6NeyYVvWdfdg60
- **Telegram chat ID:** 8330350412
