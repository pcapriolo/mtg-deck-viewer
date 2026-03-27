import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const botUrl =
    process.env.BOT_HEALTH_URL || "http://localhost:3001/health";

  try {
    const res = await fetch(botUrl, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { status: "unreachable", error: `HTTP ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { status: "unreachable" },
      { status: 502 }
    );
  }
}
