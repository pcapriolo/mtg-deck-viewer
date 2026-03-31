/**
 * Image-only eval runner — runs OCR on image eval cases and reports accuracy.
 * Usage: npx tsx bot/eval-images-only.ts
 */

import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load bot/.env which has ANTHROPIC_API_KEY
const __filename2 = fileURLToPath(import.meta.url);
config({ path: path.resolve(path.dirname(__filename2), ".env") });
import { countCards } from "./ocr";
import type { EvalMetadata } from "./eval-capture";
import { parseDeckMap, diffDecklists, type EvalResult } from "./eval-runner";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVALS_DIR = path.resolve(__dirname, "../test-fixtures/evals");

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export type AccuracyBuckets = { perfect: number; good: number; fair: number; poor: number; bad: number };

export function bucketAccuracy(results: Pick<EvalResult, "cardNameAccuracy">[]): AccuracyBuckets {
  const buckets: AccuracyBuckets = { perfect: 0, good: 0, fair: 0, poor: 0, bad: 0 };
  for (const r of results) {
    if (r.cardNameAccuracy >= 0.95) buckets.perfect++;
    else if (r.cardNameAccuracy >= 0.80) buckets.good++;
    else if (r.cardNameAccuracy >= 0.60) buckets.fair++;
    else if (r.cardNameAccuracy >= 0.30) buckets.poor++;
    else buckets.bad++;
  }
  return buckets;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY required for image evals");
    process.exit(1);
  }

  const allCases = fs.readdirSync(EVALS_DIR)
    .filter((d) => d !== ".gitkeep" && d !== "baseline.json" && fs.statSync(path.join(EVALS_DIR, d)).isDirectory())
    .sort();

  // Filter to image-only cases
  const imageCases: string[] = [];
  for (const c of allCases) {
    const metaPath = path.join(EVALS_DIR, c, "metadata.json");
    if (!fs.existsSync(metaPath)) continue;
    const meta: EvalMetadata = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (meta.inputType === "image" || meta.inputType === "both") {
      const hasImage = ["input.jpg", "input.png", "input.webp"]
        .some((f) => fs.existsSync(path.join(EVALS_DIR, c, f)));
      if (hasImage) imageCases.push(c);
    }
  }

  console.log(`\n📊 Running ${imageCases.length} IMAGE eval cases...\n`);

  const results: EvalResult[] = [];
  const failures: { caseId: string; nameAcc: number; qtyAcc: number; gtCount: number; outCount: number }[] = [];
  let completed = 0;

  for (const caseName of imageCases) {
    const caseDir = path.join(EVALS_DIR, caseName);
    completed++;
    process.stdout.write(`  [${completed}/${imageCases.length}] ${caseName}... `);

    const groundTruth = fs.readFileSync(path.join(caseDir, "ground-truth.txt"), "utf8");
    const groundTruthCount = countCards(groundTruth);

    const imageFile = ["input.jpg", "input.png", "input.webp"]
      .map((f) => path.join(caseDir, f))
      .find((f) => fs.existsSync(f))!;

    let output = "";
    const errors: string[] = [];

    try {
      // Read image from disk and call Anthropic API directly with base64 data
      const imageBuffer = fs.readFileSync(imageFile);
      const ext = path.extname(imageFile).slice(1);
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic();
      const imageSource = { type: "base64" as const, media_type: mime as "image/jpeg" | "image/png" | "image/webp", data: imageBuffer.toString("base64") };

      const extractMsg = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: imageSource },
            { type: "text", text: "Extract the Magic: The Gathering decklist from this image. Output ONLY the decklist in the format:\n<quantity> <card name>\n\nFor example:\n4 Lightning Bolt\n2 Counterspell\n\nInclude mainboard and sideboard (prefix sideboard with 'Sideboard:' on its own line). Do not include set codes or collector numbers. Do not include any other text." }
          ]
        }],
      });

      const rawText = extractMsg.content[0].type === "text" ? extractMsg.content[0].text : "";
      if (rawText.trim()) {
        output = rawText.trim();
      } else {
        errors.push("OCR returned empty");
      }
    } catch (err) {
      errors.push(`OCR error: ${err}`);
    }

    const diff = output
      ? diffDecklists(groundTruth, output)
      : { cardNameAccuracy: 0, quantityAccuracy: 0, countMatch: false };
    const outputCount = output ? countCards(output) : 0;

    const r: EvalResult = {
      caseId: caseName,
      inputType: "image",
      verified: false,
      groundTruthCount,
      outputCount,
      cardNameAccuracy: diff.cardNameAccuracy,
      quantityAccuracy: diff.quantityAccuracy,
      countMatch: diff.countMatch,
      scryfallResolved: 0,
      errors,
    };
    results.push(r);

    if (errors.length > 0) {
      console.log(`⏭️  ${errors[0]}`);
    } else {
      const nameP = (diff.cardNameAccuracy * 100).toFixed(0);
      const qtyP = (diff.quantityAccuracy * 100).toFixed(0);
      console.log(`names=${nameP}% qty=${qtyP}% count=${diff.countMatch ? "✅" : "❌"} (${outputCount}/${groundTruthCount})`);
      if (diff.cardNameAccuracy < 0.5) {
        failures.push({ caseId: caseName, nameAcc: diff.cardNameAccuracy, qtyAcc: diff.quantityAccuracy, gtCount: groundTruthCount, outCount: outputCount });
      }
    }

    // Rate limit: 500ms between API calls
    await new Promise((r) => setTimeout(r, 500));
  }

  // ── Aggregate report ──
  const valid = results.filter((r) => r.errors.length === 0);
  const errored = results.filter((r) => r.errors.length > 0);

  console.log("\n" + "═".repeat(70));
  console.log("📈 IMAGE EVAL REPORT");
  console.log("═".repeat(70));
  console.log(`Total image cases:   ${imageCases.length}`);
  console.log(`Successful OCR:      ${valid.length}  (${(valid.length / imageCases.length * 100).toFixed(1)}%)`);
  console.log(`Failed/Errored:      ${errored.length}`);
  console.log("");
  console.log(`Card name accuracy:  ${(avg(valid.map((r) => r.cardNameAccuracy)) * 100).toFixed(1)}%`);
  console.log(`Quantity accuracy:   ${(avg(valid.map((r) => r.quantityAccuracy)) * 100).toFixed(1)}%`);
  console.log(`Exact count match:   ${valid.filter((r) => r.countMatch).length}/${valid.length} (${(valid.filter((r) => r.countMatch).length / valid.length * 100).toFixed(1)}%)`);

  // Bucket distribution
  const buckets = bucketAccuracy(valid);

  console.log("\n── Accuracy Distribution ──");
  console.log(`  95-100% (excellent): ${buckets.perfect}`);
  console.log(`  80-94%  (good):      ${buckets.good}`);
  console.log(`  60-79%  (fair):      ${buckets.fair}`);
  console.log(`  30-59%  (poor):      ${buckets.poor}`);
  console.log(`   0-29%  (bad):       ${buckets.bad}`);

  if (errored.length > 0) {
    console.log("\n── Errors ──");
    const errCounts = new Map<string, number>();
    for (const r of errored) {
      for (const e of r.errors) {
        errCounts.set(e, (errCounts.get(e) ?? 0) + 1);
      }
    }
    for (const [err, count] of [...errCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}x  ${err}`);
    }
  }

  if (failures.length > 0) {
    console.log("\n── Worst Cases (<50% name accuracy) ──");
    failures.sort((a, b) => a.nameAcc - b.nameAcc);
    for (const f of failures.slice(0, 15)) {
      console.log(`  ${f.caseId}: names=${(f.nameAcc * 100).toFixed(0)}% qty=${(f.qtyAcc * 100).toFixed(0)}% cards=${f.outCount}/${f.gtCount}`);
    }
  }

  // Write JSON report
  const report = {
    timestamp: new Date().toISOString(),
    totalCases: imageCases.length,
    successfulOcr: valid.length,
    ocrSuccessRate: valid.length / imageCases.length,
    cardNameAccuracy: avg(valid.map((r) => r.cardNameAccuracy)),
    quantityAccuracy: avg(valid.map((r) => r.quantityAccuracy)),
    exactCountMatch: valid.filter((r) => r.countMatch).length / valid.length,
    distribution: buckets,
    perCase: results.map((r) => ({
      caseId: r.caseId,
      cardNameAccuracy: r.cardNameAccuracy,
      quantityAccuracy: r.quantityAccuracy,
      countMatch: r.countMatch,
      groundTruthCount: r.groundTruthCount,
      outputCount: r.outputCount,
      errors: r.errors,
    })),
  };
  fs.writeFileSync(
    path.join(EVALS_DIR, "image-eval-report.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );
  console.log("\n📄 Full report saved to test-fixtures/evals/image-eval-report.json");
}

main().catch((err) => {
  console.error("Eval runner failed:", err);
  process.exit(1);
});
