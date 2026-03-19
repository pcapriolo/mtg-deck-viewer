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

import { createClient, fetchMentions, fetchTweet, replyWithLink, MentionTweet } from "./twitter";
import { extractDecklistFromImages } from "./ocr";
import { encodeDeckUrl, summarizeDecklist } from "./encoder";

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
  const mentions = await fetchMentions(reader, BOT_USER_ID, sinceId);

  if (mentions.length === 0) return;

  // Update sinceId to the newest mention
  sinceId = mentions[0].id;

  for (const mention of mentions) {
    if (processed.has(mention.id)) continue;
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
  // Step 1: Collect images from the mention itself and up the reply chain
  const images = await collectImages(reader, mention);

  if (images.length === 0) {
    console.log("   ⚠️  No images found in thread. Skipping.");
    return;
  }

  console.log(`   🖼️  Found ${images.length} image(s). Running OCR...`);

  // Step 2: OCR the images
  const decklist = await extractDecklistFromImages(images);

  if (!decklist) {
    console.log("   ⚠️  No decklist found in images. Skipping.");
    return;
  }

  const lineCount = decklist.split("\n").filter((l) => l.trim()).length;
  console.log(`   ✅ Extracted decklist: ${lineCount} lines`);

  // Step 3: Generate the deck viewer URL
  const deckUrl = encodeDeckUrl(decklist, DECK_VIEWER_URL);
  const summary = summarizeDecklist(decklist);

  console.log(`   🔗 ${deckUrl}`);
  console.log(`   📝 ${summary}`);

  // Step 4: Reply
  const replyId = await replyWithLink(writer, mention.id, deckUrl, summary);
  console.log(`   ✅ Replied: https://x.com/i/status/${replyId}\n`);
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

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
