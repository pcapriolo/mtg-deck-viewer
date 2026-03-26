/**
 * Eval capture — saves "interesting" bot interactions as test fixtures
 * for future OCR pipeline regression testing.
 *
 * Each eval case is a directory containing:
 *   - input.{jpg,png,webp}  — original image from X.com (before URL expires)
 *   - input-text.txt         — tweet text decklist (if text-based input)
 *   - ground-truth.txt       — final corrected decklist (best-effort, manually fixable)
 *   - metadata.json          — context: tweet ID, corrections, counts, etc.
 *
 * Cases are saved to test-fixtures/evals/ and committed to git.
 * Only "interesting" interactions are captured (corrections needed, cards unresolved, etc.)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface EvalMetadata {
  tweetId: string;
  authorUsername: string;
  capturedAt: string;
  inputType: "image" | "text" | "both";
  expectedCount: number | null;
  actualCount: number;
  ocrPassCount: number;
  scryfallCardsNotFound: string[];
  correctionsApplied: Record<string, string>;
  healingRan: boolean;
  healingAccepted: boolean;
  verified: boolean;
}

const EVALS_DIR = path.resolve(__dirname, "../test-fixtures/evals");

/**
 * Save an eval case to disk. Fire-and-forget — never crashes the bot.
 */
export async function captureEvalCase(params: {
  imageUrl: string | null;
  inputText: string | null;
  groundTruth: string;
  metadata: EvalMetadata;
}): Promise<void> {
  try {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const shortId = crypto.randomUUID().slice(0, 8);
    const caseDir = path.join(EVALS_DIR, `${date}_${shortId}`);

    fs.mkdirSync(caseDir, { recursive: true });

    // Save the image (download before X.com URL expires)
    if (params.imageUrl) {
      try {
        const resp = await fetch(params.imageUrl);
        if (resp.ok) {
          const contentType = resp.headers.get("content-type") ?? "image/jpeg";
          const ext = contentType.includes("png") ? "png"
            : contentType.includes("webp") ? "webp"
            : "jpg";
          const buffer = Buffer.from(await resp.arrayBuffer());
          fs.writeFileSync(path.join(caseDir, `input.${ext}`), buffer);
        } else {
          console.error(`   ⚠️  Eval: failed to download image (${resp.status})`);
        }
      } catch (err) {
        console.error("   ⚠️  Eval: image download error:", err);
      }
    }

    // Save text input (if deck came from tweet text)
    if (params.inputText) {
      fs.writeFileSync(path.join(caseDir, "input-text.txt"), params.inputText, "utf8");
    }

    // Save ground truth decklist
    fs.writeFileSync(path.join(caseDir, "ground-truth.txt"), params.groundTruth, "utf8");

    // Save metadata
    fs.writeFileSync(
      path.join(caseDir, "metadata.json"),
      JSON.stringify(params.metadata, null, 2),
      "utf8"
    );

    console.log(`   📁 Eval case saved: ${date}_${shortId}`);
  } catch (err) {
    // Never crash the bot over eval capture
    console.error("   ⚠️  Eval capture failed:", err);
  }
}

/**
 * Check if an interaction is "interesting" enough to save as an eval case.
 */
export function shouldCaptureEval(params: {
  scryfallCardsNotFound: string[];
  healingRan: boolean;
  ocrCorrectionRan: boolean;
  expectedCount: number | null;
  actualCount: number;
}): boolean {
  if (params.scryfallCardsNotFound.length > 0) return true;
  if (params.healingRan) return true;
  if (params.ocrCorrectionRan) return true;
  if (params.expectedCount !== null && params.expectedCount !== params.actualCount) return true;
  return false;
}
