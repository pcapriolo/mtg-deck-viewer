// MTG Deck Viewer — Quality Review Cron
// Runs hourly via system crontab. Detects quality issues, self-heals code.
//
// Install: crontab -e -> add:
//   37 * * * * cd /Users/paulcapriolo/MTG/deck-viewer && npx tsx scripts/review-cron.ts >> /tmp/mtg-review-cron.log 2>&1

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "node:child_process";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DECK_VIEWER_URL =
  process.env.DECK_VIEWER_URL ?? "https://mtg-deck-viewer-production.up.railway.app";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Interaction {
  tweetId: string;
  ocrSuccess: boolean;
  ocrCardsExtracted: number;
  ocrExpectedCount?: number | null;
  mainboardCount: number;
  scryfallCardsNotFound?: string[];
  totalTimeMs: number;
  imageUrl?: string | null;
  errors?: Array<{ type: string; message: string }>;
}

interface QualityIssue {
  type: "count_mismatch" | "low_extraction" | "ocr_failure" | "scryfall_miss" | "high_latency";
  severity: "critical" | "warning";
  tweetId: string;
  imageUrl: string | null;
  details: string;
  expectedCount?: number;
  actualCount?: number;
}

interface StatsResponse {
  interactions: Interaction[];
  summary: {
    total: number;
    successes: number;
    failures: number;
    avgTotalTimeMs: number | null;
  };
}

interface DiagnosisResult {
  diagnosis: string;
  missedCards: string[];
  promptFix: string;
  confidence: "high" | "medium" | "low";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendTelegram(message: string): Promise<number | null> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return null;
  const truncated = message.length > 4096 ? message.slice(0, 4093) + "..." : message;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: truncated }),
    });
    const data = (await res.json()) as any;
    return data.result?.message_id ?? null;
  } catch (err) {
    console.error("Telegram send failed:", err);
    return null;
  }
}

async function sendTelegramPhoto(imageUrl: string, caption: string): Promise<number | null> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return null;
  const truncatedCaption = caption.length > 1024 ? caption.slice(0, 1021) + "..." : caption;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        photo: imageUrl,
        caption: truncatedCaption,
      }),
    });
    const data = (await res.json()) as any;
    return data.result?.message_id ?? null;
  } catch (err) {
    console.error("Telegram sendPhoto failed:", err);
    return null;
  }
}

/**
 * Poll Telegram for a reply to a specific message. Returns the reply text or null on timeout.
 */
async function waitForReply(afterMessageId: number, timeoutMs: number = 300000): Promise<string | null> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return null;
  const start = Date.now();
  let offset = 0;

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30`,
      );
      const data = (await res.json()) as any;

      for (const update of data.result || []) {
        offset = update.update_id + 1;
        if (
          update.message?.chat?.id === Number(TELEGRAM_CHAT_ID) &&
          update.message?.reply_to_message?.message_id === afterMessageId
        ) {
          return update.message.text ?? null;
        }
      }
    } catch (err) {
      console.error("Telegram poll error:", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  return null;
}

async function fetchImageAsBase64(
  imageUrl: string,
): Promise<{ base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }> {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);

  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const contentType = response.headers.get("content-type") ?? "image/jpeg";

  const mediaType = contentType.startsWith("image/png")
    ? ("image/png" as const)
    : contentType.startsWith("image/webp")
      ? ("image/webp" as const)
      : contentType.startsWith("image/gif")
        ? ("image/gif" as const)
        : ("image/jpeg" as const);

  return { base64, mediaType };
}

function run(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", cwd: "/Users/paulcapriolo/MTG/deck-viewer" }).trim();
}

/**
 * Locate the `railway` CLI binary.
 * Checks common install locations so execSync succeeds even in restricted cron PATH.
 */
export function resolveRailwayBin(): string {
  const candidates = [
    "railway",
    "/opt/homebrew/bin/railway",
    "/usr/local/bin/railway",
    `${process.env.HOME ?? ""}/.railway/bin/railway`,
  ];
  for (const bin of candidates) {
    try {
      execSync(`${bin} --version`, { stdio: "ignore", timeout: 3000 });
      return bin;
    } catch {
      // not found at this path — try next
    }
  }
  return "railway"; // fallback: let it fail with a clear error
}

/**
 * Returns true if two successive uptime readings are identical, indicating a
 * frozen (hung) process that is not advancing its event loop.
 * A tiny epsilon (0.1s) handles floating-point noise on healthy processes.
 */
export function isFrozenUptime(uptime1: number, uptime2: number): boolean {
  return Math.abs(uptime2 - uptime1) < 0.1;
}

// ---------------------------------------------------------------------------
// Step 1: Fetch metrics
// ---------------------------------------------------------------------------

async function fetchStats(): Promise<StatsResponse> {
  const res = await fetch(`${DECK_VIEWER_URL}/api/stats?hours=1`);
  if (!res.ok) throw new Error(`Stats API returned ${res.status}`);
  return res.json() as Promise<StatsResponse>;
}

// ---------------------------------------------------------------------------
// Step 2: Detect quality issues
// ---------------------------------------------------------------------------

function detectIssues(interactions: Interaction[]): QualityIssue[] {
  const issues: QualityIssue[] = [];

  for (const ix of interactions) {
    const imageUrl = ix.imageUrl ?? null;

    // 1. count_mismatch (critical)
    if (
      ix.ocrExpectedCount != null &&
      ix.ocrCardsExtracted < ix.ocrExpectedCount * 0.9
    ) {
      issues.push({
        type: "count_mismatch",
        severity: "critical",
        tweetId: ix.tweetId,
        imageUrl,
        details: `Image shows ${ix.ocrExpectedCount} cards but OCR only got ${ix.ocrCardsExtracted}`,
        expectedCount: ix.ocrExpectedCount,
        actualCount: ix.ocrCardsExtracted,
      });
      continue; // Don't double-flag the same interaction
    }

    // 2. low_extraction (warning)
    if (ix.mainboardCount < 40 && ix.ocrSuccess === true) {
      issues.push({
        type: "low_extraction",
        severity: "warning",
        tweetId: ix.tweetId,
        imageUrl,
        details: `Only ${ix.mainboardCount} cards extracted — suspicious for any constructed format`,
        actualCount: ix.mainboardCount,
      });
      continue;
    }

    // 3. ocr_failure (critical)
    if (ix.ocrSuccess === false) {
      issues.push({
        type: "ocr_failure",
        severity: "critical",
        tweetId: ix.tweetId,
        imageUrl,
        details: "OCR returned failure",
      });
      continue;
    }

    // 4. scryfall_miss (warning)
    const notFound = ix.scryfallCardsNotFound ?? [];
    if (notFound.length > 3) {
      issues.push({
        type: "scryfall_miss",
        severity: "warning",
        tweetId: ix.tweetId,
        imageUrl,
        details: `${notFound.length} cards not found on Scryfall — likely OCR misspellings: ${notFound.slice(0, 5).join(", ")}`,
      });
      continue;
    }

    // 5. high_latency (warning)
    if (ix.totalTimeMs > 30000) {
      issues.push({
        type: "high_latency",
        severity: "warning",
        tweetId: ix.tweetId,
        imageUrl,
        details: `Total time ${(ix.totalTimeMs / 1000).toFixed(1)}s exceeds 30s threshold`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Step 3 & 4: Analyze and (optionally) fix critical issues
// ---------------------------------------------------------------------------

async function analyzeAndFix(issues: QualityIssue[]): Promise<void> {
  if (!ANTHROPIC_API_KEY) {
    console.log("No ANTHROPIC_API_KEY — skipping analysis.");
    return;
  }

  const criticalWithImage = issues.filter(
    (i) => (i.type === "count_mismatch" || i.type === "ocr_failure") && i.imageUrl,
  );

  if (criticalWithImage.length === 0) return;

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  // Read current OCR prompt from bot/ocr.ts
  const ocrFilePath = "/Users/paulcapriolo/MTG/deck-viewer/bot/ocr.ts";
  let ocrSource: string;
  try {
    ocrSource = fs.readFileSync(ocrFilePath, "utf-8");
  } catch {
    console.error("Could not read bot/ocr.ts");
    return;
  }

  // Extract the EXTRACTION_PROMPT string
  const promptMatch = ocrSource.match(
    /const EXTRACTION_PROMPT = `([\s\S]*?)`;/,
  );
  const currentPrompt = promptMatch ? promptMatch[1] : "(could not extract prompt)";

  let prCreated = false;

  for (const issue of criticalWithImage) {
    if (prCreated) break; // Max 1 PR per cron run

    console.log(`\nAnalyzing issue: ${issue.type} for tweet ${issue.tweetId}`);

    try {
      const { base64, mediaType } = await fetchImageAsBase64(issue.imageUrl!);

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64 },
              },
              {
                type: "text",
                text: `You are debugging an OCR failure for a Magic: The Gathering decklist extractor.

The image shows a decklist. The OCR was supposed to extract all cards but got it wrong.

EXPECTED: ${issue.expectedCount ?? "unknown"} cards
ACTUAL: ${issue.actualCount ?? "unknown"} cards extracted

CURRENT OCR PROMPT (from bot/ocr.ts):
${currentPrompt}

Analyze:
1. What cards/sections did the OCR miss? Look at the image carefully.
2. WHY did it miss them? (new layout? hidden column? badge misread? prompt gap?)
3. What specific change to the EXTRACTION_PROMPT would fix this?

Output as JSON:
{
  "diagnosis": "one sentence explaining the root cause",
  "missedCards": ["list of card names visible in image but missing from output"],
  "promptFix": "the specific text to add/change in the prompt",
  "confidence": "high/medium/low"
}`,
              },
            ],
          },
        ],
      });

      const responseText = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as Anthropic.TextBlock).text)
        .join("");

      // Parse JSON from response (may be wrapped in markdown code fences)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log("Could not parse diagnosis JSON from response");
        await sendTelegram(
          `\u26a0\ufe0f Quality issue (${issue.type}) for tweet ${issue.tweetId} but could not parse diagnosis. Raw: ${responseText.slice(0, 500)}`,
        );
        continue;
      }

      let diagnosis: DiagnosisResult;
      try {
        diagnosis = JSON.parse(jsonMatch[0]) as DiagnosisResult;
      } catch {
        console.log("Malformed JSON in diagnosis response");
        await sendTelegram(
          `\u26a0\ufe0f Quality issue (${issue.type}) for tweet ${issue.tweetId} — diagnosis JSON parse failed.`,
        );
        continue;
      }

      console.log(`Diagnosis: ${diagnosis.diagnosis}`);
      console.log(`Confidence: ${diagnosis.confidence}`);
      console.log(`Missed cards: ${diagnosis.missedCards.join(", ")}`);

      if (diagnosis.confidence === "high") {
        // Attempt auto-fix
        console.log("High confidence — attempting auto-fix...");

        try {
          // Apply the prompt fix
          const updatedSource = ocrSource.replace(
            currentPrompt,
            currentPrompt + "\n\n" + diagnosis.promptFix,
          );

          if (updatedSource === ocrSource) {
            console.log("Prompt replacement had no effect — skipping.");
            await sendTelegram(
              `\ud83d\udd27 High-confidence diagnosis but replacement failed.\nDiagnosis: ${diagnosis.diagnosis}\nPrompt fix: ${diagnosis.promptFix}`,
            );
            continue;
          }

          fs.writeFileSync(ocrFilePath, updatedSource);
          console.log("Wrote updated ocr.ts");

          // Verify the module still loads
          try {
            run('npx tsx -e "import \'./bot/ocr.ts\'"');
            console.log("Module loads OK");
          } catch (err) {
            console.log("Module load failed — reverting");
            fs.writeFileSync(ocrFilePath, ocrSource);
            await sendTelegram(
              `\u274c Auto-fix broke module load — reverted.\nDiagnosis: ${diagnosis.diagnosis}`,
            );
            continue;
          }

          // Run tests
          try {
            run("npm run test:run");
            console.log("Tests passed");
          } catch (err) {
            console.log("Tests failed — reverting");
            fs.writeFileSync(ocrFilePath, ocrSource);
            await sendTelegram(
              `\u274c Auto-fix broke tests — reverted.\nDiagnosis: ${diagnosis.diagnosis}`,
            );
            continue;
          }

          // Create branch, commit, push, PR
          const branchName = `fix/ocr-${Date.now()}`;
          try {
            run(`git checkout -b ${branchName}`);
            run("git add bot/ocr.ts");
            run(
              `git commit -m "fix(ocr): ${diagnosis.diagnosis.slice(0, 60)}"`,
            );
            run(`git push -u origin ${branchName}`);
            const prUrl = run(
              `gh pr create --title "fix(ocr): ${diagnosis.diagnosis.slice(0, 60)}" --body "Auto-generated by review-cron.\n\nDiagnosis: ${diagnosis.diagnosis}\nMissed cards: ${diagnosis.missedCards.join(", ")}\nPrompt addition: ${diagnosis.promptFix.slice(0, 200)}"`,
            );
            console.log(`PR created: ${prUrl}`);
            await sendTelegram(
              `\ud83d\udd27 PR created: ${prUrl}\nDiagnosis: ${diagnosis.diagnosis}`,
            );
            prCreated = true;
          } catch (err) {
            // Revert file and branch on git failure
            fs.writeFileSync(ocrFilePath, ocrSource);
            try {
              run("git checkout main");
              run(`git branch -D ${branchName}`);
            } catch {
              /* best effort cleanup */
            }
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error("Git/PR creation failed:", errMsg);
            await sendTelegram(
              `\u274c Auto-fix git/PR failed: ${errMsg.slice(0, 200)}\nDiagnosis: ${diagnosis.diagnosis}`,
            );
          }
        } catch (err) {
          // Revert on any unexpected error
          fs.writeFileSync(ocrFilePath, ocrSource);
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error("Auto-fix failed:", errMsg);
          await sendTelegram(
            `\u274c Auto-fix failed: ${errMsg.slice(0, 200)}\nDiagnosis: ${diagnosis.diagnosis}`,
          );
        }
      } else {
        // Medium/low confidence — report but don't fix
        await sendTelegram(
          `\u26a0\ufe0f Quality issue detected but fix confidence is ${diagnosis.confidence}.\nDiagnosis: ${diagnosis.diagnosis}\nMissed cards: ${diagnosis.missedCards.join(", ")}\nImage: ${issue.imageUrl}`,
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Analysis failed for tweet ${issue.tweetId}:`, errMsg);
      await sendTelegram(
        `\u274c Claude analysis failed for tweet ${issue.tweetId}: ${errMsg.slice(0, 300)}\nIssue: ${issue.details}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Feedback-driven fix: user replies on Telegram with what was missed
// ---------------------------------------------------------------------------

async function handleFeedback(
  interaction: Interaction,
  feedback: string,
): Promise<void> {
  if (!ANTHROPIC_API_KEY || !interaction.imageUrl) return;

  await sendTelegram("Investigating based on your feedback...");

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const ocrFilePath = "/Users/paulcapriolo/MTG/deck-viewer/bot/ocr.ts";
  const ocrSource = fs.readFileSync(ocrFilePath, "utf-8");

  const promptMatch = ocrSource.match(/const EXTRACTION_PROMPT = `([\s\S]*?)`;/);
  const currentPrompt = promptMatch ? promptMatch[1] : "(could not extract prompt)";

  const { base64, mediaType } = await fetchImageAsBase64(interaction.imageUrl);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: `You are fixing an OCR prompt for a Magic: The Gathering decklist extractor.

The image shows a decklist. The OCR extracted ${interaction.ocrCardsExtracted} cards${interaction.ocrExpectedCount ? ` but the image shows ${interaction.ocrExpectedCount}` : ""}.

USER FEEDBACK on what was missed:
${feedback}

CURRENT EXTRACTION_PROMPT:
${currentPrompt}

Based on the user's feedback and the image, produce a specific fix to the EXTRACTION_PROMPT.
Output as JSON:
{
  "diagnosis": "one sentence root cause",
  "promptFix": "the exact text to ADD to the prompt (will be appended)",
  "confidence": "high"
}` },
      ],
    }],
  });

  const responseText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("");

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    await sendTelegram("Could not generate a fix from your feedback. Raw response saved to logs.");
    return;
  }

  const diagnosis = JSON.parse(jsonMatch[0]) as DiagnosisResult;

  // Apply fix
  const updatedSource = ocrSource.replace(
    currentPrompt,
    currentPrompt + "\n\n" + diagnosis.promptFix,
  );

  if (updatedSource === ocrSource) {
    await sendTelegram(`Could not apply fix — prompt replacement had no effect.\nDiagnosis: ${diagnosis.diagnosis}`);
    return;
  }

  fs.writeFileSync(ocrFilePath, updatedSource);

  // Run tests
  try {
    run("npm run test:run");
  } catch {
    fs.writeFileSync(ocrFilePath, ocrSource);
    await sendTelegram("Fix broke tests — reverted. Manual investigation needed.");
    return;
  }

  // Run eval regression check
  let evalResult = "not run";
  try {
    run("npm run eval");
    evalResult = "PASS (no regressions)";
  } catch {
    evalResult = "REGRESSION DETECTED";
  }

  // Save feedback as verified eval case
  try {
    const evalDir = `./test-fixtures/evals/${new Date().toISOString().slice(0, 10)}_feedback_${interaction.tweetId.slice(-8)}`;
    fs.mkdirSync(evalDir, { recursive: true });
    fs.writeFileSync(`${evalDir}/metadata.json`, JSON.stringify({
      tweetId: interaction.tweetId,
      authorUsername: "user-feedback",
      capturedAt: new Date().toISOString(),
      inputType: interaction.imageUrl ? "image" : "text",
      expectedCount: interaction.ocrExpectedCount ?? null,
      actualCount: interaction.mainboardCount,
      ocrPassCount: 0,
      scryfallCardsNotFound: interaction.scryfallCardsNotFound ?? [],
      correctionsApplied: {},
      healingRan: false,
      healingAccepted: false,
      verified: true,
      userFeedback: feedback,
      diagnosis: diagnosis.diagnosis,
    }, null, 2));
    // Ground truth will need manual creation — save the feedback as a note for now
    fs.writeFileSync(`${evalDir}/feedback.txt`, feedback);
    console.log(`Saved feedback eval case: ${evalDir}`);
  } catch (err) {
    console.error("Failed to save eval case:", err);
  }

  // Create branch + PR
  const branchName = `fix/ocr-${Date.now()}`;
  try {
    run(`git checkout -b ${branchName}`);
    run("git add bot/ocr.ts");
    run(`git commit -m "fix(ocr): ${diagnosis.diagnosis.slice(0, 60)}"`);
    run(`git push -u origin ${branchName}`);
    const prUrl = run(
      `gh pr create --title "fix(ocr): ${diagnosis.diagnosis.slice(0, 60)}" --body "Feedback-driven fix from review cron.\n\nUser feedback: ${feedback}\nDiagnosis: ${diagnosis.diagnosis}\nPrompt addition: ${diagnosis.promptFix.slice(0, 300)}\nEval: ${evalResult}"`,
    );

    // Ask user to approve merge
    const mergeMsg = await sendTelegram(
      `🔧 Fix ready!\n\nPR: ${prUrl}\nDiagnosis: ${diagnosis.diagnosis}\nTests: PASS\nEval: ${evalResult}\n\nReply "merge" to merge or "reject" to close.`,
    );

    if (mergeMsg) {
      const mergeReply = await waitForReply(mergeMsg, 300000);
      if (mergeReply?.match(/merge|yes|approve|lgtm|ship/i)) {
        const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1];
        if (prNumber) {
          run(`gh pr merge ${prNumber} --merge`);
          await sendTelegram(`Merged PR #${prNumber}. Railway will auto-deploy.`);
        }
      } else if (mergeReply?.match(/reject|no|close|cancel/i)) {
        const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1];
        if (prNumber) run(`gh pr close ${prNumber}`);
        fs.writeFileSync(ocrFilePath, ocrSource);
        run("git checkout main");
        run(`git branch -D ${branchName}`);
        await sendTelegram("PR closed and changes reverted.");
      } else {
        await sendTelegram(`No response or unclear reply. PR is open: ${prUrl}`);
      }
    }
  } catch (err) {
    fs.writeFileSync(ocrFilePath, ocrSource);
    try { run("git checkout main"); run(`git branch -D ${branchName}`); } catch { /* cleanup */ }
    await sendTelegram(`Git/PR failed: ${String(err).slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Telegram PR Approval — check for MERGE/REJECT replies to open PRs
// ---------------------------------------------------------------------------

/**
 * Check for any recent Telegram messages and act on PR commands.
 *
 * Supports TWO patterns:
 *
 * 1. Swipe-reply to a PR notification message:
 *    Original: "PR #8: test/deck-exporter — 124 tests passing..."
 *    Reply: "merge"
 *
 * 2. Standalone message with PR number:
 *    "merge 5", "merge #5", "reject 5", "diff 5"
 */
async function checkPendingPRApprovals(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  console.log("Checking for pending Telegram replies (PR approvals + late feedback)...");

  try {
    // Get recent updates (non-blocking, 1s timeout)
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?timeout=1`,
    );
    const data = (await res.json()) as any;
    const updates = data.result || [];

    let maxUpdateId = 0;

    for (const update of updates) {
      if (update.update_id > maxUpdateId) maxUpdateId = update.update_id;

      const msg = update.message;
      if (!msg || String(msg.chat?.id) !== TELEGRAM_CHAT_ID) continue;

      const text = (msg.text ?? "").trim();
      const replyText = msg.reply_to_message?.text ?? "";

      // --- Pattern A: Late deck feedback (reply to "What did I miss?") ---
      if (replyText.includes("What did I miss?") && text && !text.match(/looks?\s*good|lgtm|ok|fine|perfect|👍|good/i)) {
        console.log(`Late deck feedback received: "${text.slice(0, 60)}..."`);

        // Find the tweet ID from the photo caption in the message chain
        // The photo message is the one BEFORE "What did I miss?" in the thread
        const photoCaption = msg.reply_to_message?.reply_to_message?.caption ?? "";
        const tweetMatch = photoCaption.match(/status\/(\d+)/);
        const imageUrlMatch = photoCaption.match(/https:\/\/pbs\.twimg\.com\S+/);

        if (tweetMatch) {
          const tweetId = tweetMatch[1];
          console.log(`Matched to tweet ${tweetId} — fetching interaction data...`);

          try {
            // Fetch the interaction from stats to get full context
            const statsRes = await fetch(`${DECK_VIEWER_URL}/api/stats?hours=24`);
            const statsData = (await statsRes.json()) as StatsResponse;
            const ix = statsData.interactions.find((i) => i.tweetId === tweetId);

            if (ix) {
              await handleFeedback(ix, text);
            } else {
              // Construct minimal interaction from what we know
              await handleFeedback({
                tweetId,
                ocrSuccess: true,
                ocrCardsExtracted: 0,
                mainboardCount: 0,
                totalTimeMs: 0,
                imageUrl: imageUrlMatch?.[0] ?? null,
              }, text);
            }
          } catch (err) {
            console.error("Late feedback handling failed:", err);
            await sendTelegram(`❌ Failed to process late feedback: ${String(err).slice(0, 200)}`);
          }
        } else {
          console.log("Could not extract tweet ID from photo caption — skipping late feedback");
        }
        continue;
      }

      // --- Pattern B: PR approval commands ---
      let prNumber: string | null = null;
      let command: string | null = null;

      // Swipe-reply to a PR notification
      const replyPrMatch = replyText.match(/PR\s*#(\d+)/i);
      if (replyPrMatch) {
        prNumber = replyPrMatch[1];
        command = text.toLowerCase();
      }

      // Standalone message like "merge 5", "merge #5", "reject #5", "diff 5"
      if (!prNumber) {
        const standaloneMatch = text.match(/^(merge|reject|close|cancel|diff|show|view|approve|lgtm|ship|yes|no)\s*#?(\d+)$/i);
        if (standaloneMatch) {
          command = standaloneMatch[1].toLowerCase();
          prNumber = standaloneMatch[2];
        }
      }

      if (!prNumber || !command) continue;

      if (command.match(/^(merge|yes|approve|lgtm|ship)$/i)) {
        console.log(`User approved PR #${prNumber} via Telegram`);
        try {
          run(`gh pr merge ${prNumber} --squash`);
          await sendTelegram(`Merged PR #${prNumber}. Railway will auto-deploy from main.`);
        } catch (err) {
          await sendTelegram(`Failed to merge PR #${prNumber}: ${String(err).slice(0, 200)}`);
        }
      } else if (command.match(/^(reject|no|close|cancel)$/i)) {
        console.log(`User rejected PR #${prNumber} via Telegram`);
        try {
          run(`gh pr close ${prNumber}`);
          await sendTelegram(`Closed PR #${prNumber}.`);
        } catch (err) {
          await sendTelegram(`Failed to close PR #${prNumber}: ${String(err).slice(0, 200)}`);
        }
      } else if (command.match(/^(diff|show|view)$/i)) {
        console.log(`User requested diff for PR #${prNumber} via Telegram`);
        try {
          const diff = run(`gh pr diff ${prNumber} --stat`);
          const title = run(`gh pr view ${prNumber} --json title -q .title`);
          await sendTelegram(`PR #${prNumber}: ${title}\n\n${diff.slice(0, 3500)}`);
        } catch (err) {
          await sendTelegram(`Failed to fetch PR #${prNumber}: ${String(err).slice(0, 200)}`);
        }
      }
    }

    // Acknowledge processed updates so we don't re-process them
    if (maxUpdateId > 0) {
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${maxUpdateId + 1}&timeout=1`,
      );
    }
  } catch (err) {
    console.error("Telegram reply check failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function triggerRedeploy(reason: string): Promise<void> {
  const railwayBin = resolveRailwayBin();
  const cmd = `${railwayBin} redeploy --service mtg-bot-v2 -y`;
  console.error(`WATCHDOG: ${reason} — running: ${cmd}`);
  try {
    execSync(cmd, {
      timeout: 30000,
      shell: "/bin/bash",
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` },
    });
    console.log("Redeploy command succeeded");
    await sendTelegram(`✅ Bot redeploy triggered (${reason})`);
  } catch (e) {
    const errMsg = String(e).slice(0, 300);
    console.error(`WATCHDOG REDEPLOY FAILED: ${errMsg}`);
    await sendTelegram(`❌ Bot redeploy failed (${reason}): ${errMsg}`);
    return; // skip verification if redeploy command itself failed
  }

  // Verify recovery: wait 60s, then check if the bot is actually alive
  console.log("WATCHDOG: Waiting 60s for bot to start...");
  await new Promise((r) => setTimeout(r, 60_000));
  try {
    const res = await fetch(`${DECK_VIEWER_URL}/api/bot-health`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      if (data.uptime < 120 && data.pollCount > 0) {
        console.log(`WATCHDOG: Bot recovered — uptime=${Math.round(data.uptime)}s polls=${data.pollCount}`);
        await sendTelegram(`✅ Bot recovered after redeploy. Uptime: ${Math.round(data.uptime)}s, polls: ${data.pollCount}`);
      } else if (data.uptime < 120) {
        console.log(`WATCHDOG: Bot restarted but no polls yet — uptime=${Math.round(data.uptime)}s`);
        await sendTelegram(`⚠️ Bot restarted (uptime: ${Math.round(data.uptime)}s) but 0 polls yet. May need more time.`);
      } else {
        console.error(`WATCHDOG: Bot still stale after redeploy — uptime=${Math.round(data.uptime)}s`);
        await sendTelegram(`🚨 Bot still stale after redeploy (uptime: ${Math.round(data.uptime)}s). Manual intervention needed.`);
      }
    } else {
      console.error(`WATCHDOG: Bot health returned ${res.status} after redeploy`);
      await sendTelegram(`🚨 Bot unreachable after redeploy (HTTP ${res.status}). Manual intervention needed.`);
    }
  } catch (err) {
    console.error("WATCHDOG: Post-redeploy health check failed:", err);
    await sendTelegram("🚨 Post-redeploy health check failed. Manual intervention needed.");
  }
}

async function checkBotHealth(): Promise<void> {
  console.log("Checking bot health...");
  try {
    // Fetch bot health twice, 5s apart, to detect frozen uptime
    const res1 = await fetch(`${DECK_VIEWER_URL}/api/bot-health`, { signal: AbortSignal.timeout(5000) });
    if (!res1.ok) {
      console.error(`WATCHDOG: Bot health endpoint returned ${res1.status} — unreachable`);
      await sendTelegram("🚨 Bot unreachable — auto-redeploying...");
      await triggerRedeploy("bot unreachable");
      return;
    }

    const data1 = await res1.json();
    await new Promise((r) => setTimeout(r, 5000));
    const res2 = await fetch(`${DECK_VIEWER_URL}/api/bot-health`, { signal: AbortSignal.timeout(5000) });
    const data2 = res2.ok ? await res2.json() : null;

    // Frozen uptime = process is hung (not crashing, just not advancing event loop)
    if (data2 && isFrozenUptime(data1.uptime, data2.uptime)) {
      console.error(`WATCHDOG: Bot has frozen uptime (${data1.uptime}s unchanged over 5s) — redeploying`);
      await sendTelegram(`🚨 Bot frozen (uptime stuck at ${Math.round(data1.uptime)}s) — auto-redeploying...`);
      await triggerRedeploy(`frozen uptime ${Math.round(data1.uptime)}s`);
      return;
    }

    // Check for high notification failures
    if (data1.notificationFailCount > 3) {
      await sendTelegram(`⚠️ Bot notification failures: ${data1.notificationFailCount}`);
    }

    console.log(`Bot healthy: uptime=${Math.round(data1.uptime)}s polls=${data1.pollCount}`);
  } catch (err) {
    console.error("WATCHDOG: Bot health check threw — attempting redeploy:", err);
    await sendTelegram("🚨 Bot health check failed — attempting redeploy...");
    await triggerRedeploy("health check error");
  }
}

async function main(): Promise<void> {
  const timestamp = new Date().toISOString();
  console.log(`\n=== Review cron: ${timestamp} ===`);

  // Step 0a: Check bot health and auto-restart if dead
  await checkBotHealth();

  // Step 0b: Check for pending PR approval replies on Telegram
  await checkPendingPRApprovals();

  // Step 1: Fetch stats
  let stats: StatsResponse;
  try {
    stats = await fetchStats();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("Could not reach stats API:", errMsg);
    await sendTelegram(`⚠️ Review cron: could not reach /api/stats — ${errMsg}`);
    process.exit(1);
  }

  const { interactions, summary } = stats;
  const total = summary.total;
  const successRate =
    total > 0 ? Math.round((summary.successes / total) * 100) : 100;

  console.log(`Total: ${total}, Success rate: ${successRate}%`);

  if (total === 0) {
    await sendTelegram("🃏 Hourly review: no interactions in the last hour.");
    // Still write heartbeat before returning
    try {
      const hbPath = "./agent-heartbeat.json";
      const hb = fs.existsSync(hbPath) ? JSON.parse(fs.readFileSync(hbPath, "utf-8")) : {};
      hb.REVIEW = new Date().toISOString();
      fs.writeFileSync(hbPath, JSON.stringify(hb, null, 2));
    } catch (e) {
      console.error("Failed to write heartbeat:", e);
    }
    console.log("Done.");
    return;
  }

  // Step 2: For each interaction, send image + decklist to Telegram for review
  for (const ix of interactions) {
    if (ix.imageUrl) {
      // Send the original image
      const caption =
        `📊 Tweet: https://x.com/i/status/${ix.tweetId}\n` +
        `Cards: ${ix.ocrCardsExtracted} extracted` +
        (ix.ocrExpectedCount ? ` / ${ix.ocrExpectedCount} expected` : "") +
        `\nScryfall: ${ix.scryfallCardsNotFound?.length ?? 0} not found` +
        `\nLatency: ${(ix.totalTimeMs / 1000).toFixed(1)}s`;

      const photoMsg = await sendTelegramPhoto(ix.imageUrl, caption);

      // Send decklist as follow-up
      const decklistMsg = await sendTelegram(
        `📋 What did I miss? Reply to this message with feedback, or "looks good" to confirm.`,
      );

      if (decklistMsg) {
        console.log(`Waiting for feedback on tweet ${ix.tweetId}...`);
        const feedback = await waitForReply(decklistMsg, 300000); // 5 min timeout

        if (feedback && !feedback.match(/looks?\s*good|lgtm|ok|fine|perfect|👍|good/i)) {
          console.log(`Got feedback: ${feedback}`);
          try {
            await handleFeedback(ix, feedback);
          } catch (err) {
            console.error("handleFeedback error:", err);
            await sendTelegram(`❌ Failed to process feedback: ${String(err).slice(0, 200)}`);
          }
        } else if (feedback) {
          console.log("User confirmed quality — moving on.");
        } else {
          console.log("No feedback within timeout — moving on.");
        }
      }
    }
  }

  // Step 3: Detect automated issues (for interactions without images, or issues user didn't flag)
  const issues = detectIssues(interactions);
  console.log(`Automated issues detected: ${issues.length}`);

  if (issues.length > 0) {
    // Run auto-analysis for critical issues that weren't addressed by user feedback
    try {
      await analyzeAndFix(issues);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("analyzeAndFix failed:", errMsg);
      await sendTelegram(`❌ Review cron analyzeAndFix error: ${errMsg.slice(0, 300)}`);
    }

    const issuesSummary = issues
      .map((i) => `${i.severity === "critical" ? "❗" : "⚠️"} [${i.type}] tweet ${i.tweetId}: ${i.details}`)
      .join("\n");

    await sendTelegram(
      `⚠️ Hourly review: ${issues.length} issue(s) found.\n${issuesSummary}\nStats: ${DECK_VIEWER_URL}/stats`,
    );
  } else {
    await sendTelegram(
      `🃏 Hourly review: ${total} interactions, ${successRate}% success. All clear.`,
    );
  }

  // Write heartbeat so the status dashboard and PLAN agent know REVIEW is alive
  try {
    const hbPath = "./agent-heartbeat.json";
    const hb = fs.existsSync(hbPath) ? JSON.parse(fs.readFileSync(hbPath, "utf-8")) : {};
    hb.REVIEW = new Date().toISOString();
    fs.writeFileSync(hbPath, JSON.stringify(hb, null, 2));
  } catch (e) {
    console.error("Failed to write heartbeat:", e);
  }

  console.log("Done.");
}

main().catch(async (err) => {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error("Unhandled error in review cron:", errMsg);
  await sendTelegram(`\u274c Review cron crashed: ${errMsg.slice(0, 300)}`);
  process.exit(1);
});
