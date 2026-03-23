import fs from "fs";
import path from "path";

/**
 * Determines the metrics storage directory.
 * Uses /data/metrics/ on Railway (volume mount), ./data/metrics/ locally.
 */
export function getMetricsDir(): string {
  const railwayPath = "/data/metrics";
  if (fs.existsSync(railwayPath)) {
    return railwayPath;
  }
  return path.resolve(process.cwd(), "data", "metrics");
}

/**
 * Ensures the metrics directory exists.
 */
export function ensureMetricsDir(): string {
  const dir = getMetricsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Returns the JSONL file path for a given date string (YYYY-MM-DD).
 */
export function metricsFilePath(dateStr: string): string {
  return path.join(getMetricsDir(), `metrics-${dateStr}.jsonl`);
}

/**
 * Returns the engagement JSONL file path.
 */
export function engagementFilePath(): string {
  return path.join(getMetricsDir(), "engagement.jsonl");
}

// ── Log rotation ───────────────────────────────────────────

let lastRotationCheck = 0;
const ROTATION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MAX_AGE_DAYS = 30;

/**
 * Deletes metrics files older than 30 days. Runs at most once per hour.
 */
export function rotateOldFiles(): void {
  const now = Date.now();
  if (now - lastRotationCheck < ROTATION_INTERVAL_MS) return;
  lastRotationCheck = now;

  const dir = getMetricsDir();
  if (!fs.existsSync(dir)) return;

  const cutoff = now - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const match = file.match(/^metrics-(\d{4}-\d{2}-\d{2})\.jsonl$/);
    if (!match) continue;
    const fileDate = new Date(match[1] + "T00:00:00Z").getTime();
    if (fileDate < cutoff) {
      fs.unlinkSync(path.join(dir, file));
    }
  }
}

// ── JSONL parsing & summary ────────────────────────────────

export interface InteractionLog {
  tweetId: string;
  timestamp: string;
  ocrSuccess?: boolean;
  replySent?: boolean;
  totalTimeMs?: number;
  ocrTimeMs?: number;
  variant?: string;
  error?: string;
  [key: string]: unknown;
}

export interface MetricsSummary {
  total: number;
  successes: number;
  failures: number;
  avgTotalTimeMs: number | null;
  avgOcrTimeMs: number | null;
  variantDistribution: Record<string, number>;
  topErrors: { error: string; count: number }[];
}

/**
 * Parses JSONL content into InteractionLog objects, skipping malformed lines.
 */
export function parseJsonl(content: string): InteractionLog[] {
  const results: InteractionLog[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  }
  return results;
}

/**
 * Filters entries to those within the given time window (hours before now).
 */
export function filterByTimeWindow(entries: InteractionLog[], hours: number): InteractionLog[] {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return entries.filter((e) => e.timestamp >= cutoff);
}

/**
 * Computes a summary from a list of interaction logs.
 */
export function computeSummary(entries: InteractionLog[]): MetricsSummary {
  const total = entries.length;
  const successes = entries.filter((e) => e.ocrSuccess === true && e.replySent === true).length;
  const failures = total - successes;

  const totalTimes = entries.map((e) => e.totalTimeMs).filter((t): t is number => typeof t === "number");
  const ocrTimes = entries.map((e) => e.ocrTimeMs).filter((t): t is number => typeof t === "number");

  const avgTotalTimeMs = totalTimes.length > 0 ? totalTimes.reduce((a, b) => a + b, 0) / totalTimes.length : null;
  const avgOcrTimeMs = ocrTimes.length > 0 ? ocrTimes.reduce((a, b) => a + b, 0) / ocrTimes.length : null;

  const variantDistribution: Record<string, number> = {};
  for (const e of entries) {
    if (e.variant) {
      variantDistribution[e.variant] = (variantDistribution[e.variant] || 0) + 1;
    }
  }

  const errorCounts: Record<string, number> = {};
  for (const e of entries) {
    if (e.error) {
      errorCounts[e.error] = (errorCounts[e.error] || 0) + 1;
    }
  }
  const topErrors = Object.entries(errorCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([error, count]) => ({ error, count }));

  return { total, successes, failures, avgTotalTimeMs, avgOcrTimeMs, variantDistribution, topErrors };
}

/**
 * Returns date strings (YYYY-MM-DD) covering the given hours window.
 */
export function getDateStringsForWindow(hours: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  const start = new Date(now.getTime() - hours * 60 * 60 * 1000);

  const current = new Date(start);
  current.setUTCHours(0, 0, 0, 0);

  while (current <= now) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}
