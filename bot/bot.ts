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
import { extractDecklistFromImages, OcrResult } from "./ocr";
import {
  encodeDeckUrl,
  composeReplyText,
  composeReplyTextVariant,
  selectVariant,
  encodeDeckUrlWithUtm,
  extractDeckName,
} from "./encoder";
import { fetchCards } from "./scryfall";
import { deriveDeckStats } from "./stats";
import { reconcileContext } from "./reconcile";
import { logInteraction, InteractionLog } from "./interaction-log";
import { sendTelegramAlert } from "./notify";

const SINCE_ID_FILE = "./since-id.txt";
const FRESH_START_WINDOW = 5 * 60 * 1000; // 5 minutes

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL ?? "60", 10) * 1000;
const DECK_VIEWER_URL = process.env.DECK_VIEWER_URL ?? "http://localhost:3000";
const BOT_USER_ID = process.env.X_BOT_USER_ID ?? "";
const MAX_CHAIN_DEPTH = 5; // How far up the reply chain to look for images

// Track processed mentions to avoid duplicates across restarts
const processed = new Set<string>();
let sinceId: string | undefined;

// Health counters — exposed via the health server
const startedAt = new Date().toISOString();
let lastPollAt: string | null = null;
let lastNotificationAttempt: string | null = null;
let lastNotificationSuccess: string | null = null;
let notificationFailCount = 0;

async function trackNotification(result: boolean): Promise<void> {
  lastNotificationAttempt = new Date().toISOString();
  if (result) {
    lastNotificationSuccess = lastNotificationAttempt;
  } else {
    notificationFailCount++;
  }
}

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
  lastPollAt = new Date().toISOString();
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
  const startTime = Date.now();
  const utmId = crypto.randomUUID();
  const variant = selectVariant();
  const errors: Array<{ type: string; message: string }> = [];

  let ocrTimeMs = 0;
  let scryfallTimeMs = 0;
  let replyTimeMs = 0;
  let ocrSuccess = false;
  let ocrCardsExtracted = 0;
  let scryfallCardsResolved = 0;
  let scryfallCardsNotFound: string[] = [];
  let replySent = false;
  let replyTweetId: string | undefined;
  let deckName: string | undefined;
  let mainboardCount = 0;
  let sideboardCount = 0;

  let cardNames: string[] = [];
  let decklistText: string | null = null;
  let ocrResult: OcrResult | null = null;

  try {
    // Step 1: Collect thread context (images + tweet texts)
    const threadCtx = await collectThreadContext(reader, mention);

    // Step 2: Try text-based decklist detection before image OCR
    const ocrStart = Date.now();
    const textDecklist = extractDecklistFromText(mention.text);
    if (textDecklist) {
      const lineCount = textDecklist.split("\n").filter((l) => l.trim()).length;
      console.log(`   📝 Found decklist in text: ${lineCount} lines`);
      decklistText = textDecklist;
      ocrSuccess = true;
      ocrCardsExtracted = lineCount;
    } else {
      if (threadCtx.images.length === 0) {
        console.log("   ⚠️  No images or decklist found in thread. Skipping.");
        ocrTimeMs = Date.now() - ocrStart;
        // Log the skip
        logInteraction({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          tweetId: mention.id,
          authorId: mention.authorId,
          authorUsername: mention.authorUsername,
          tweetText: mention.text.slice(0, 280),
          imageCount: threadCtx.images.length,
          ocrSuccess: false, ocrPassCount: 0, ocrCardsExtracted: 0,
          ocrTimeMs, ocrErrors: ["No images or decklist found"],
          scryfallCardsResolved: 0, scryfallCardsNotFound: [], scryfallTimeMs: 0,
          replySent: false, replyFormatVariant: variant, replyTimeMs: 0,
          totalTimeMs: Date.now() - startTime,
          mainboardCount: 0, sideboardCount: 0, utmId, errors,
          ocrExpectedCount: null, ocrCorrectionRan: false, ocrCorrectionAccepted: false,
          imageUrl: null,
        });
        return;
      }

      console.log(`   🖼️  Found ${threadCtx.images.length} image(s). Running OCR...`);

      // Step 3: OCR the images
      ocrResult = await extractDecklistFromImages(threadCtx.images);

      if (!ocrResult) {
        console.log("   ⚠️  No decklist found in images. Skipping.");
        ocrTimeMs = Date.now() - ocrStart;
        logInteraction({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          tweetId: mention.id,
          authorId: mention.authorId,
          authorUsername: mention.authorUsername,
          tweetText: mention.text.slice(0, 280),
          imageCount: threadCtx.images.length,
          ocrSuccess: false, ocrPassCount: threadCtx.images.length, ocrCardsExtracted: 0,
          ocrTimeMs, ocrErrors: ["OCR returned no decklist"],
          scryfallCardsResolved: 0, scryfallCardsNotFound: [], scryfallTimeMs: 0,
          replySent: false, replyFormatVariant: variant, replyTimeMs: 0,
          totalTimeMs: Date.now() - startTime,
          mainboardCount: 0, sideboardCount: 0, utmId, errors,
          ocrExpectedCount: null, ocrCorrectionRan: false, ocrCorrectionAccepted: false,
          imageUrl: threadCtx.images[0] ?? null,
        });
        return;
      }

      decklistText = ocrResult.decklist;
      ocrCardsExtracted = ocrResult.actualCount;
      const lineCount = decklistText.split("\n").filter((l) => l.trim()).length;
      console.log(`   ✅ Extracted decklist: ${lineCount} lines`);
      ocrSuccess = true;
    }
    ocrTimeMs = Date.now() - ocrStart;

    // Step 4: Enrich with Scryfall data
    const ocrDeckName = extractDeckName(decklistText);
    deckName = ocrDeckName;
    let replyText: string;

    try {
      cardNames = decklistText
        .split("\n")
        .map((l) => l.match(/^\d+\s+(.+)$/)?.[1]?.trim())
        .filter(Boolean) as string[];

      const scryfallStart = Date.now();
      const cards = await fetchCards(cardNames);
      scryfallTimeMs = Date.now() - scryfallStart;

      scryfallCardsResolved = Object.keys(cards).length;
      const resolvedNames = new Set(Object.values(cards).map((c) => c.name.toLowerCase()));
      scryfallCardsNotFound = cardNames.filter((n) => !resolvedNames.has(n.toLowerCase()));

      // Step 5: Reconcile context — combine tweet text + OCR + card list
      const ocrAuthor = extractAuthor(decklistText);
      console.log(`   🔍 Reconciling context (${threadCtx.texts.length} tweet(s))...`);
      const context = await reconcileContext(threadCtx.texts, ocrDeckName ?? null, ocrAuthor, cardNames);

      const finalName = context.deckName ?? ocrDeckName;
      deckName = finalName ?? undefined;
      if (context.deckName && context.deckName !== ocrDeckName) {
        console.log(`   📛 Reconciled name: "${context.deckName}" (OCR: "${ocrDeckName ?? "none"}")`);
      }
      if (context.hallmarkCard) {
        console.log(`   ⭐ Hallmark card: ${context.hallmarkCard}`);
      }
      if (context.author) {
        console.log(`   👤 Author: ${context.author}`);
      }

      // Use hallmark card from reconciliation for stats/OG preview
      const stats = deriveDeckStats(cards, decklistText, finalName, context.hallmarkCard);
      mainboardCount = stats.mainCount;
      sideboardCount = stats.sideCount;

      console.log(`   🎨 Colors: ${stats.colorPips || "(colorless)"}`);
      console.log(`   📊 ${stats.creatureCount} creatures, ${stats.spellCount} spells, ${stats.landCount} lands`);

      // Inject reconciled name + author into the decklist text for URL encoding
      if (finalName && !ocrDeckName) {
        decklistText = `Name: ${finalName}\n${decklistText}`;
      } else if (finalName && ocrDeckName && finalName !== ocrDeckName) {
        decklistText = decklistText.replace(/^name[:\s]+.+$/im, `Name: ${finalName}`);
      }
      if (context.author && !ocrAuthor) {
        // Insert author after name line or at top
        const nameIdx = decklistText.indexOf("\n");
        if (decklistText.startsWith("Name:") && nameIdx > 0) {
          decklistText = decklistText.slice(0, nameIdx) + `\nAuthor: ${context.author}` + decklistText.slice(nameIdx);
        } else {
          decklistText = `Author: ${context.author}\n${decklistText}`;
        }
      }

      replyText = composeReplyTextVariant(stats, finalName ?? undefined, variant);
    } catch (err) {
      console.error("   ⚠️  Enrichment failed, using basic reply:", err);
      errors.push({ type: "enrichment", message: String(err) });
      mainboardCount = decklistText
        .split("\n")
        .filter((l) => /^\d+\s/.test(l.trim()))
        .reduce((sum, l) => sum + parseInt(l.match(/^(\d+)/)?.[1] ?? "0"), 0);
      replyText = ocrDeckName
        ? `${ocrDeckName} · ${mainboardCount} cards\n\n▶ View deck →`
        : `${mainboardCount}-card deck\n\n▶ View deck →`;
    }

    // Step 6: Generate the deck viewer URL
    const deckUrl = encodeDeckUrlWithUtm(decklistText, DECK_VIEWER_URL, utmId);

    console.log(`   🔗 ${deckUrl}`);
    console.log(`   📝 ${replyText.split("\n")[0]}`);

    // Step 7: Quality gate — skip reply if deck looks bad
    const gate = checkReplyQuality({
      ocrCardsExtracted,
      scryfallCardsResolved,
      cardNamesCount: cardNames.length,
      mainboardCount,
      deckUrl,
      expectedBaseUrl: DECK_VIEWER_URL,
    });

    if (!gate.pass) {
      console.log(`   ⛔ Quality gate failed: ${gate.reason}. Skipping reply.`);
      const skipNotified = await sendTelegramAlert(
        `⛔ *Skipped reply* to @${mention.authorUsername}\nReason: ${gate.reason}\nTweet: https://x.com/i/status/${mention.id}`
      );
      await trackNotification(skipNotified);
    } else {
      // Step 8: Reply
      const replyStart = Date.now();
      replyTweetId = await replyWithLink(writer, mention.id, deckUrl, replyText);
      replyTimeMs = Date.now() - replyStart;
      replySent = true;
      console.log(`   ✅ Replied: https://x.com/i/status/${replyTweetId}\n`);

      // Notify on Telegram after every successful reply
      const deckLabel = deckName ?? `${mainboardCount}-card deck`;
      const notified = await sendTelegramAlert(
        `🃏 *Reply sent*\n` +
        `Deck: ${deckLabel}\n` +
        `Cards: ${ocrCardsExtracted} extracted, ${scryfallCardsResolved} resolved\n` +
        `Variant: ${variant}\n` +
        `Reply: https://x.com/i/status/${replyTweetId}\n` +
        `Original: https://x.com/i/status/${mention.id}\n` +
        `Latency: ${((ocrTimeMs + scryfallTimeMs + replyTimeMs) / 1000).toFixed(1)}s`
      );
      await trackNotification(notified);
      if (!notified) console.warn("⚠️ Telegram notification failed for reply", replyTweetId);
    }
  } catch (err) {
    errors.push({ type: "handleMention", message: String(err) });
    console.error(`   ❌ Error in handleMention for ${mention.id}:`, err);
    const errNotified = await sendTelegramAlert(
      `*Bot Error*\nTweet: ${mention.id}\nAuthor: @${mention.authorUsername}\nError: ${String(err).slice(0, 500)}`
    );
    await trackNotification(errNotified);
    if (!errNotified) console.warn("⚠️ Telegram error notification also failed for", mention.id);
  }

  // Log interaction metrics (fire-and-forget)
  // Note: log rotation for JSONL files > 30 days is handled by the web app side
  logInteraction({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    tweetId: mention.id,
    authorId: mention.authorId,
    authorUsername: mention.authorUsername,
    tweetText: mention.text.slice(0, 280),
    imageCount: 0, // filled from threadCtx above when available
    ocrSuccess,
    ocrPassCount: ocrSuccess ? 1 : 0,
    ocrCardsExtracted,
    ocrTimeMs,
    ocrErrors: [],
    scryfallCardsResolved,
    scryfallCardsNotFound,
    scryfallTimeMs,
    replySent,
    replyTweetId,
    replyFormatVariant: variant,
    replyTimeMs,
    totalTimeMs: Date.now() - startTime,
    deckName,
    mainboardCount,
    sideboardCount,
    utmId,
    errors,
    ocrExpectedCount: ocrResult?.expectedCount ?? null,
    ocrCorrectionRan: ocrResult?.correctionRan ?? false,
    ocrCorrectionAccepted: ocrResult?.correctionAccepted ?? false,
    imageUrl: ocrResult?.imageUrl ?? null,
  });
}

/**
 * Extract author from raw decklist text (looks for "Author: X" line).
 */
function extractAuthor(text: string): string | null {
  for (const line of text.split("\n")) {
    const match = line.match(/^author[:\s]+(.+)$/i);
    if (match) return match[1].trim();
  }
  return null;
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

  // Keep card lines AND section headers (Sideboard, Side, Companion, Commander, Name, Author)
  const deckLines = lines.filter((l) =>
    /^\d+x?\s+\w/i.test(l) ||
    /^(sideboard|side|companion|commander)$/i.test(l) ||
    /^(name|author)[:\s]/i.test(l)
  );

  // Need at least 3 card lines (not counting headers)
  const cardCount = deckLines.filter((l) => /^\d+x?\s+\w/i.test(l)).length;
  if (cardCount < 3) return null;

  return deckLines.join("\n");
}

interface ThreadContext {
  images: string[];
  texts: string[];  // tweet texts from the chain (newest first)
}

/**
 * Walk up the reply chain from a mention to collect images AND tweet texts.
 */
async function collectThreadContext(
  reader: ReturnType<typeof createClient>["reader"],
  mention: MentionTweet
): Promise<ThreadContext> {
  const images: string[] = [...mention.imageUrls];
  const texts: string[] = [mention.text];

  let currentTweetId = mention.inReplyToId;
  let depth = 0;

  while (currentTweetId && depth < MAX_CHAIN_DEPTH) {
    const tweet = await fetchTweet(reader, currentTweetId);
    if (!tweet) break;

    if (tweet.imageUrls.length > 0) {
      images.push(...tweet.imageUrls);
    }
    if (tweet.text.trim()) {
      texts.push(tweet.text);
    }

    currentTweetId = tweet.inReplyToId;
    depth++;

    // Rate limit courtesy
    await sleep(200);
  }

  return { images, texts };
}

export function checkReplyQuality(params: {
  ocrCardsExtracted: number;
  scryfallCardsResolved: number;
  cardNamesCount: number;
  mainboardCount: number;
  deckUrl: string;
  expectedBaseUrl: string;
}): { pass: boolean; reason: string } {
  try {
    if (params.ocrCardsExtracted < 3)
      return { pass: false, reason: `Only ${params.ocrCardsExtracted} card lines extracted (need 3+)` };
    if (params.scryfallCardsResolved < 3)
      return { pass: false, reason: `Only ${params.scryfallCardsResolved} cards resolved on Scryfall (need 3+)` };
    if (params.cardNamesCount > 0 && params.scryfallCardsResolved / params.cardNamesCount < 0.5)
      return { pass: false, reason: `Only ${Math.round((params.scryfallCardsResolved / params.cardNamesCount) * 100)}% of card names resolved (need 50%+)` };
    if (params.mainboardCount < 10)
      return { pass: false, reason: `Only ${params.mainboardCount} mainboard cards (need 10+)` };
    if (!params.deckUrl.startsWith(params.expectedBaseUrl) || params.deckUrl.length > 2000)
      return { pass: false, reason: params.deckUrl.length > 2000 ? "Deck URL too long" : "Deck URL has wrong base" };
    return { pass: true, reason: "ok" };
  } catch (err) {
    return { pass: false, reason: `Quality check error: ${err}` };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Minimal health endpoint for Railway (expects a port)
import http from "node:http";
const PORT = process.env.PORT ?? "3001";

function startHealthServer() {
  http
    .createServer((_req, res) => {
      const payload = {
        status: "ok",
        startedAt,
        uptime: process.uptime(),
        lastPollAt,
        lastNotificationAttempt,
        lastNotificationSuccess,
        notificationFailCount,
        telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    })
    .listen(parseInt(PORT), () => {
      console.log(`   Health endpoint on :${PORT}`);
    });
}

// Only run when executed directly (not when imported for testing)
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("bot.ts") || process.argv[1].endsWith("bot.js"));

if (isMainModule) {
  startHealthServer();
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
