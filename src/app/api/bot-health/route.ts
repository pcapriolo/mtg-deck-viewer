import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Prevent Railway's edge proxy from caching this health check response.
const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
};

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
        { status: "unreachable", error: `HTTP ${res.status}`, checkedAt: new Date().toISOString() },
        { status: 502, headers: NO_CACHE_HEADERS }
      );
    }

    const data = await res.json();
    return NextResponse.json(
      { ...data, checkedAt: new Date().toISOString() },
      { headers: NO_CACHE_HEADERS }
    );
  } catch {
    return NextResponse.json(
      { status: "unreachable", checkedAt: new Date().toISOString() },
      { status: 502, headers: NO_CACHE_HEADERS }
    );
  }
}
