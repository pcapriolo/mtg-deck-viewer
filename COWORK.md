# MTG Deck Viewer — Scheduled Reply Task

## Schedule

Run as a Claude Code scheduled task every 60 minutes.

## Task

Find TWO decklist tweets and reply to each with just `@mtgviewer`:
1. One tweet with a **decklist image** (screenshot)
2. One tweet with a **text decklist** (card names typed out)

## Step 1: Find an image decklist tweet

Search Twitter:
- `MTG deck has:images -is:retweet`
- `decklist has:images -is:retweet`
- `deck tech MTG has:images`

Pick a tweet with a screenshot of a decklist (Arena, MTGO, or web deck builder). Skip if already replied to by @mtgviewer, bot/spam account, or non-English.

Reply: `@mtgviewer`

## Step 2: Find a text decklist tweet

Search Twitter:
- `"4x" OR "4 " lightning OR creature OR sideboard MTG -has:images -is:retweet`
- `decklist -has:images -is:retweet`

Pick a tweet where someone typed out card names and quantities (e.g. "4 Lightning Bolt, 4 Counterspell..."). Skip if already replied to by @mtgviewer.

Reply: `@mtgviewer`

## Rules

- TWO replies per session: one image, one text. No more.
- Always reply with just `@mtgviewer` — nothing else.
- Never reply to the same user twice in 24 hours.
- Skip either reply if no good tweet is found.
- Be respectful — you're a guest in someone's thread.

## After Every Run

1. **Write heartbeat** to `agent-heartbeat.json`:
   ```
   // Update the OPERATE timestamp to current ISO time
   { "OPERATE": "2026-03-23T14:02:00Z" }
   ```

2. **Append a one-line entry** to the "Recently Completed" section of `claude-progress.txt`:
   ```
   - [YYYY-MM-DD OPERATE] [X] replies sent (image: [yes/no], text: [yes/no])
   ```
   Or if no tweets found:
   ```
   - [YYYY-MM-DD OPERATE] no suitable tweets found
   ```

## Environment

- **Your Twitter:** @paulcapriolo
- **Bot:** @MtgViewer
