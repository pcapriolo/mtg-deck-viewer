/**
 * MTG Deck Viewer Bot — polls X for mentions, extracts decklists from images,
 * generates interactive viewer links, and replies.
 *
 * Flow:
 *   1. Poll @mentions every POLL_INTERVAL seconds
 *   2. For each mention, walk up the reply chain to find images
 *   3. OCR the images with Claude Vision
 *   4. Generate a deck viewer URL
 *   5. Reply with the link
 *
 * Environment variables:
 *   X_BEARER_TOKEN     — App bearer token (reading tweets)
 *   X_APP_KEY          — OAuth 1.0a consumer key (posting)
 *   X_APP_SECRET       — OAuth 1.0a consumer secret
 *   X_ACCESS_TOKEN     — OAuth 1.0a access token
 *   X_ACCESS_SECRET    — OAuth 1.0a access secret
 *   X_BOT_USER_ID      — The bot account's user ID (numeric)
 *   ANTHROPIC_API_KEY  — For Claude Vision OCR
 *   DECK_VIEWER_URL    — Base URL of the deployed deck viewer (e.g. https://mtgdeck.app)
 *   POLL_INTERVAL      — Seconds between polls (default: 60)
 */

import "dotenv/config";
import fs from "node:fs";
import { createClient, fetchMentions, fetchTweet, replyWithLink, MentionTweet } from "./twitter";
import { extractDecklistFromImages } from "./ocr";
import { encodeDeckUrl, summarizeDecklist } from "./encoder";

const SINCE_ID_FILE = "./since-id.txt";
const FRESH_START_WINDOW = 5 * 60 * 1000; // 5 minutes

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL ?? "60", 10) * 1000;
const DECK_VIEWER_URL = process.env.DECK_VIEWER_URL ?? "http://localhost:3000";
const BOT_USER_ID = process.env.X_BOT_USER_ID ?? "";
const MAX_CHAIN_DEPTH = 5; // How far up the reply chain to look for images

// Track processed mentions to avoid duplicates across restarts
const processed = new Set<string>();
let sinceId: string | undefined;

async function main() {
  console.log("🃏 MTG Deck Viewer Bot starting...");
  console.log(`   Viewer URL: ${DECK_VIEWER_URL}`);
  console.log(`   Poll interval: ${POLL_INTERVAL / 1000}s`);
  console.log(`   Bot user ID: ${BOT_USER_ID}`);

  if (!BOT_USER_ID) {
    throw new Error("X_BOT_USER_ID is required. Get it from: https://tweeterid.com");
  }

  const { reader, writer } = createClient();

  // Verify credentials
  try {
    const me = await writer.v2.me();
    console.log(`   Authenticated as: @${me.data.username}`);
  } catch (err) {
    throw new Error(`Failed to authenticate with X: ${err}`);
  }

  // Restore sinceId from disk if available
  try {
    sinceId = fs.readFileSync(SINCE_ID_FILE, "utf8").trim();
    console.log(`   Restored sinceId: ${sinceId}`);
  } catch {}

  console.log("   Polling for mentions...\n");

  while (true) {
    try {
      await poll(reader, writer);
    } catch (err) {
      console.error("Poll error:", err);
    }
    await sleep(POLL_INTERVAL);
  }
}

async function poll(reader: ReturnType<typeof createClient>["reader"], writer: ReturnType<typeof createClient>["writer"]) {
  const isFreshStart = sinceId === undefined;
  const mentions = await fetchMentions(reader, BOT_USER_ID, sinceId);

  if (mentions.length === 0) return;

  // On fresh start (no persisted sinceId), skip mentions older than 5 minutes
  // to avoid re-processing stale mentions after a deploy resets the filesystem
  const freshMentions = isFreshStart
    ? mentions.filter((m) => {
        const age = Date.now() - new Date(m.createdAt).getTime();
        return age < FRESH_START_WINDOW;
      })
    : mentions;

  // Update sinceId to the newest mention (even if we filtered some out)
  sinceId = mentions[0].id;
  fs.writeFileSync(SINCE_ID_FILE, sinceId);

  for (const mention of freshMentions) {
    if (processed.has(mention.id)) continue;

    // Skip self-mentions (bot replying to itself)
    if (mention.authorId === BOT_USER_ID) continue;

    processed.add(mention.id);

    console.log(`📩 Mention from @${mention.authorUsername}: "${mention.text.slice(0, 80)}..."`);

    try {
      await handleMention(reader, writer, mention);
    } catch (err) {
      console.error(`   ❌ Failed to handle mention ${mention.id}:`, err);
    }
  }
}

async function handleMention(
  reader: ReturnType<typeof createClient>["reader"],
  writer: ReturnType<typeof createClient>["writer"],
  mention: MentionTweet
) {
  // Step 1: Try text-based decklist detection before image OCR
  const textDecklist = extractDecklistFromText(mention.text);
  if (textDecklist) {
    const lineCount = textDecklist.split("\n").filter((l) => l.trim()).length;
    console.log(`   📝 Found decklist in text: ${lineCount} lines`);

    const deckUrl = encodeDeckUrl(textDecklist, DECK_VIEWER_URL);
    const summary = summarizeDecklist(textDecklist);

    console.log(`   🔗 ${deckUrl}`);
    console.log(`   📝 ${summary}`);

    const replyId = await replyWithLink(writer, mention.id, deckUrl, summary);
    console.log(`   ✅ Replied: https://x.com/i/status/${replyId}\n`);
    return;
  }

  // Step 2: Collect images from the mention itself and up the reply chain
  const images = await collectImages(reader, mention);

  if (images.length === 0) {
    console.log("   ⚠️  No images or decklist found in thread. Skipping.");
    return;
  }

  console.log(`   🖼️  Found ${images.length} image(s). Running OCR...`);

  // Step 3: OCR the images
  const decklist = await extractDecklistFromImages(images);

  if (!decklist) {
    console.log("   ⚠️  No decklist found in images. Skipping.");
    return;
  }

  const lineCount = decklist.split("\n").filter((l) => l.trim()).length;
  console.log(`   ✅ Extracted decklist: ${lineCount} lines`);

  // Step 4: Generate the deck viewer URL
  const deckUrl = encodeDeckUrl(decklist, DECK_VIEWER_URL);
  const summary = summarizeDecklist(decklist);

  console.log(`   🔗 ${deckUrl}`);
  console.log(`   📝 ${summary}`);

  // Step 5: Reply
  const replyId = await replyWithLink(writer, mention.id, deckUrl, summary);
  console.log(`   ✅ Replied: https://x.com/i/status/${replyId}\n`);
}

/**
 * Extract a decklist from tweet text by stripping @mentions and URLs,
 * then checking if 3+ lines match the "Nx CardName" pattern.
 * Returns the cleaned decklist text, or null if not enough lines match.
 */
export function extractDecklistFromText(text: string): string | null {
  const cleaned = text
    .replace(/@\w+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim();

  const lines = cleaned.split("\n").map((l) => l.trim()).filter((l) => l);
  const deckLines = lines.filter((l) => /^\d+x?\s+\w/i.test(l));

  if (deckLines.length < 3) return null;

  return deckLines.join("\n");
}

/**
 * Walk up the reply chain from a mention to find tweet images.
 * Checks the mention itself first, then its parent, grandparent, etc.
 */
async function collectImages(
  reader: ReturnType<typeof createClient>["reader"],
  mention: MentionTweet
): Promise<string[]> {
  const allImages: string[] = [...mention.imageUrls];

  let currentTweetId = mention.inReplyToId;
  let depth = 0;

  while (currentTweetId && depth < MAX_CHAIN_DEPTH) {
    const tweet = await fetchTweet(reader, currentTweetId);
    if (!tweet) break;

    if (tweet.imageUrls.length > 0) {
      allImages.push(...tweet.imageUrls);
    }

    currentTweetId = tweet.inReplyToId;
    depth++;

    // Rate limit courtesy
    await sleep(200);
  }

  return allImages;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Only run when executed directly (not when imported for testing)
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("bot.ts") || process.argv[1].endsWith("bot.js"));

if (isMainModule) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
