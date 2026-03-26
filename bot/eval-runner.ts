/**
 * Eval runner — re-runs the OCR pipeline on saved eval fixtures and
 * diffs the output against ground truth to measure accuracy.
 *
 * Usage:
 *   npm run eval                  — run evals, compare against baseline, fail on regression
 *   npm run eval -- --update      — run evals and update the baseline to current scores
 *
 * Exit codes:
 *   0 — all good (no regression, or no baseline yet)
 *   1 — regression detected (accuracy dropped vs. baseline)
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractDecklistFromImage, countCards } from "./ocr";
import { fetchCards } from "./scryfall";
import type { EvalMetadata } from "./eval-capture";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVALS_DIR = path.resolve(__dirname, "../test-fixtures/evals");
const BASELINE_PATH = path.join(EVALS_DIR, "baseline.json");

const UPDATE_BASELINE = process.argv.includes("--update");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalResult {
  caseId: string;
  inputType: string;
  verified: boolean;
  groundTruthCount: number;
  outputCount: number;
  cardNameAccuracy: number;
  quantityAccuracy: number;
  countMatch: boolean;
  scryfallResolved: number;
  errors: string[];
}

export interface Baseline {
  updatedAt: string;
  caseCount: number;
  aggregateCardNameAccuracy: number;
  aggregateQuantityAccuracy: number;
  aggregateCountMatch: number;
  aggregateScryfallResolved: number;
  cases: Record<string, { cardNameAccuracy: number; quantityAccuracy: number }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseDeckMap(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of text.split("\n")) {
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (match) {
      const qty = parseInt(match[1]);
      const name = match[2].trim().toLowerCase();
      map.set(name, (map.get(name) ?? 0) + qty);
    }
  }
  return map;
}

export function diffDecklists(
  groundTruth: string,
  output: string
): { cardNameAccuracy: number; quantityAccuracy: number; countMatch: boolean } {
  const gtMap = parseDeckMap(groundTruth);
  const outMap = parseDeckMap(output);

  if (gtMap.size === 0) return { cardNameAccuracy: 0, quantityAccuracy: 0, countMatch: false };

  let namesFound = 0;
  let quantitiesCorrect = 0;

  for (const [name, qty] of gtMap) {
    if (outMap.has(name)) {
      namesFound++;
      if (outMap.get(name) === qty) quantitiesCorrect++;
    }
  }

  const gtCount = [...gtMap.values()].reduce((a, b) => a + b, 0);
  const outCount = [...outMap.values()].reduce((a, b) => a + b, 0);

  return {
    cardNameAccuracy: namesFound / gtMap.size,
    quantityAccuracy: quantitiesCorrect / gtMap.size,
    countMatch: gtCount === outCount,
  };
}

// ---------------------------------------------------------------------------
// Run a single eval case
// ---------------------------------------------------------------------------

async function runEval(caseDir: string): Promise<EvalResult> {
  const caseId = path.basename(caseDir);
  const errors: string[] = [];

  const metaPath = path.join(caseDir, "metadata.json");
  if (!fs.existsSync(metaPath)) {
    return { caseId, inputType: "unknown", verified: false, groundTruthCount: 0, outputCount: 0,
      cardNameAccuracy: 0, quantityAccuracy: 0, countMatch: false, scryfallResolved: 0, errors: ["No metadata.json"] };
  }

  const metadata: EvalMetadata = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const groundTruth = fs.readFileSync(path.join(caseDir, "ground-truth.txt"), "utf8");
  const groundTruthCount = countCards(groundTruth);

  let output = "";

  if (metadata.inputType === "image" || metadata.inputType === "both") {
    // Skip image-based evals if no ANTHROPIC_API_KEY (e.g. in CI)
    if (!process.env.ANTHROPIC_API_KEY) {
      return { caseId, inputType: metadata.inputType, verified: metadata.verified,
        groundTruthCount, outputCount: 0, cardNameAccuracy: 0, quantityAccuracy: 0,
        countMatch: false, scryfallResolved: 0, errors: ["Skipped: no ANTHROPIC_API_KEY"] };
    }

    const imageFile = ["input.jpg", "input.png", "input.webp"]
      .map((f) => path.join(caseDir, f))
      .find((f) => fs.existsSync(f));

    if (!imageFile) {
      errors.push("No image file found");
    } else {
      try {
        const result = await extractDecklistFromImage(`file://${imageFile}`);
        if (result) {
          output = result.decklist;
        } else {
          errors.push("OCR returned null");
        }
      } catch (err) {
        errors.push(`OCR error: ${err}`);
      }
    }
  } else if (metadata.inputType === "text") {
    const textFile = path.join(caseDir, "input-text.txt");
    if (fs.existsSync(textFile)) {
      output = fs.readFileSync(textFile, "utf8");
    } else {
      errors.push("No input-text.txt found");
    }
  }

  if (!output && errors.length === 0) {
    errors.push("No output produced");
  }

  // Resolve through Scryfall (tests the correction pipeline)
  let scryfallResolved = 0;
  if (output) {
    try {
      const names = output.split("\n")
        .map((l) => l.match(/^\d+\s+(.+)$/)?.[1]?.trim())
        .filter(Boolean) as string[];
      const cards = await fetchCards(names);
      const resolvedSet = new Set(Object.values(cards).map((c) => c.name.toLowerCase()));
      scryfallResolved = names.length > 0
        ? names.filter((n) => resolvedSet.has(n.toLowerCase())).length / names.length
        : 0;
    } catch {
      errors.push("Scryfall resolution failed");
    }
  }

  const diff = output ? diffDecklists(groundTruth, output) : { cardNameAccuracy: 0, quantityAccuracy: 0, countMatch: false };
  const outputCount = output ? countCards(output) : 0;

  return {
    caseId,
    inputType: metadata.inputType,
    verified: metadata.verified,
    groundTruthCount,
    outputCount,
    cardNameAccuracy: diff.cardNameAccuracy,
    quantityAccuracy: diff.quantityAccuracy,
    countMatch: diff.countMatch,
    scryfallResolved,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Baseline comparison
// ---------------------------------------------------------------------------

function readBaseline(): Baseline | null {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeBaseline(results: EvalResult[]): void {
  const valid = results.filter((r) => r.errors.length === 0);
  if (valid.length === 0) return;

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const baseline: Baseline = {
    updatedAt: new Date().toISOString(),
    caseCount: valid.length,
    aggregateCardNameAccuracy: avg(valid.map((r) => r.cardNameAccuracy)),
    aggregateQuantityAccuracy: avg(valid.map((r) => r.quantityAccuracy)),
    aggregateCountMatch: valid.filter((r) => r.countMatch).length,
    aggregateScryfallResolved: avg(valid.map((r) => r.scryfallResolved)),
    cases: Object.fromEntries(
      valid.map((r) => [r.caseId, { cardNameAccuracy: r.cardNameAccuracy, quantityAccuracy: r.quantityAccuracy }])
    ),
  };

  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2), "utf8");
}

export function checkRegression(results: EvalResult[], baseline: Baseline): string[] {
  const valid = results.filter((r) => r.errors.length === 0);
  if (valid.length === 0) return [];

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const regressions: string[] = [];

  const currentNameAcc = avg(valid.map((r) => r.cardNameAccuracy));
  const currentQtyAcc = avg(valid.map((r) => r.quantityAccuracy));
  const currentScryfall = avg(valid.map((r) => r.scryfallResolved));

  // Check aggregate regressions (allow 0.01 tolerance for floating point)
  const TOLERANCE = 0.01;
  if (currentNameAcc < baseline.aggregateCardNameAccuracy - TOLERANCE) {
    regressions.push(`Card name accuracy dropped: ${(baseline.aggregateCardNameAccuracy * 100).toFixed(1)}% → ${(currentNameAcc * 100).toFixed(1)}%`);
  }
  if (currentQtyAcc < baseline.aggregateQuantityAccuracy - TOLERANCE) {
    regressions.push(`Quantity accuracy dropped: ${(baseline.aggregateQuantityAccuracy * 100).toFixed(1)}% → ${(currentQtyAcc * 100).toFixed(1)}%`);
  }
  if (currentScryfall < baseline.aggregateScryfallResolved - TOLERANCE) {
    regressions.push(`Scryfall resolution dropped: ${(baseline.aggregateScryfallResolved * 100).toFixed(1)}% → ${(currentScryfall * 100).toFixed(1)}%`);
  }

  // Check per-case regressions (any case that existed in baseline and got worse)
  for (const r of valid) {
    const prev = baseline.cases[r.caseId];
    if (!prev) continue;
    if (r.cardNameAccuracy < prev.cardNameAccuracy - TOLERANCE) {
      regressions.push(`${r.caseId}: name accuracy ${(prev.cardNameAccuracy * 100).toFixed(0)}% → ${(r.cardNameAccuracy * 100).toFixed(0)}%`);
    }
    if (r.quantityAccuracy < prev.quantityAccuracy - TOLERANCE) {
      regressions.push(`${r.caseId}: qty accuracy ${(prev.quantityAccuracy * 100).toFixed(0)}% → ${(r.quantityAccuracy * 100).toFixed(0)}%`);
    }
  }

  return regressions;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(EVALS_DIR)) {
    console.log("No eval cases found at", EVALS_DIR);
    process.exit(0);
  }

  const cases = fs.readdirSync(EVALS_DIR)
    .filter((d) => d !== ".gitkeep" && d !== "baseline.json" && fs.statSync(path.join(EVALS_DIR, d)).isDirectory())
    .sort();

  if (cases.length === 0) {
    console.log("No eval cases found.");
    process.exit(0);
  }

  console.log(`\n📊 Running ${cases.length} eval case(s)...\n`);

  const results: EvalResult[] = [];

  for (const caseName of cases) {
    const caseDir = path.join(EVALS_DIR, caseName);
    process.stdout.write(`  ${caseName}... `);
    const result = await runEval(caseDir);
    results.push(result);

    const status = result.errors.length > 0
      ? `⏭️  ${result.errors[0]}`
      : `names=${(result.cardNameAccuracy * 100).toFixed(0)}% qty=${(result.quantityAccuracy * 100).toFixed(0)}% count=${result.countMatch ? "✅" : "❌"} scryfall=${(result.scryfallResolved * 100).toFixed(0)}%`;
    console.log(status);

    await new Promise((r) => setTimeout(r, 500));
  }

  // Print aggregate stats
  const valid = results.filter((r) => r.errors.length === 0);
  const skipped = results.filter((r) => r.errors.some((e) => e.startsWith("Skipped")));

  console.log("\n" + "═".repeat(60));
  console.log("📈 RESULTS");
  console.log("═".repeat(60));
  console.log(`Total: ${cases.length}  Ran: ${valid.length}  Skipped: ${skipped.length}`);

  if (valid.length > 0) {
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    console.log(`  Card name accuracy:  ${(avg(valid.map((r) => r.cardNameAccuracy)) * 100).toFixed(1)}%`);
    console.log(`  Quantity accuracy:   ${(avg(valid.map((r) => r.quantityAccuracy)) * 100).toFixed(1)}%`);
    console.log(`  Count match:         ${valid.filter((r) => r.countMatch).length}/${valid.length}`);
    console.log(`  Scryfall resolved:   ${(avg(valid.map((r) => r.scryfallResolved)) * 100).toFixed(1)}%`);
  }

  // Baseline comparison
  const baseline = readBaseline();

  if (UPDATE_BASELINE || !baseline) {
    writeBaseline(results);
    if (!baseline) {
      console.log("\n📝 No baseline found — wrote initial baseline.json");
    } else {
      console.log("\n📝 Updated baseline.json with current scores");
    }
    process.exit(0);
  }

  // Check for regressions
  const regressions = checkRegression(results, baseline);

  if (regressions.length > 0) {
    console.log("\n🚨 REGRESSIONS DETECTED:");
    for (const r of regressions) {
      console.log(`  ❌ ${r}`);
    }
    console.log(`\nTo accept these scores as the new baseline: npm run eval -- --update`);
    process.exit(1);
  }

  console.log("\n✅ No regressions vs. baseline");
  process.exit(0);
}

main().catch((err) => {
  console.error("Eval runner failed:", err);
  process.exit(1);
});
