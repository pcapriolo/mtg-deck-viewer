import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import {
  getMetricsDir,
  getDateStringsForWindow,
  metricsFilePath,
  parseJsonl,
  filterByTimeWindow,
  computeSummary,
} from "@/lib/metrics-storage";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = Math.max(1, parseInt(searchParams.get("hours") || "24", 10) || 24);
    const limit = Math.max(1, parseInt(searchParams.get("limit") || "100", 10) || 100);

    const dir = getMetricsDir();
    const dateStrings = getDateStringsForWindow(hours);

    let allEntries: ReturnType<typeof parseJsonl> = [];

    for (const dateStr of dateStrings) {
      const filePath = metricsFilePath(dateStr);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, "utf-8");
      allEntries.push(...parseJsonl(content));
    }

    // Filter to time window, sort descending, apply limit
    const filtered = filterByTimeWindow(allEntries, hours);
    filtered.sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0));
    const limited = filtered.slice(0, limit);

    const summary = computeSummary(filtered);

    return NextResponse.json({ interactions: limited, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read metrics";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
