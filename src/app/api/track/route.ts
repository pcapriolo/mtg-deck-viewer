import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { ensureMetricsDir, engagementFilePath } from "@/lib/metrics-storage";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.utmId) {
      return NextResponse.json(
        { error: "Missing required field: utmId" },
        { status: 400 }
      );
    }

    const timestamp = body.timestamp || new Date().toISOString();
    const userAgent = request.headers.get("user-agent") || "";

    const event = {
      utmId: body.utmId,
      timestamp,
      userAgent,
    };

    ensureMetricsDir();
    fs.appendFileSync(engagementFilePath(), JSON.stringify(event) + "\n");

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Write failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
