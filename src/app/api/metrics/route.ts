import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { ensureMetricsDir, metricsFilePath, rotateOldFiles } from "@/lib/metrics-storage";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.tweetId || !body.timestamp) {
      return NextResponse.json(
        { error: "Missing required fields: tweetId and timestamp" },
        { status: 400 }
      );
    }

    const dir = ensureMetricsDir();
    const dateStr = new Date(body.timestamp).toISOString().slice(0, 10);
    const filePath = metricsFilePath(dateStr);

    // Ensure dir exists (metricsFilePath uses getMetricsDir, not ensureMetricsDir)
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(body) + "\n");

    // Rotate old files (at most once per hour)
    rotateOldFiles();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Write failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
