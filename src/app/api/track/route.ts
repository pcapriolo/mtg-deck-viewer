import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.utmId) {
      return NextResponse.json(
        { error: "Missing required field: utmId" },
        { status: 400 }
      );
    }

    const userAgent = request.headers.get("user-agent") || "";

    await prisma.engagement.create({
      data: {
        utmId: body.utmId,
        userAgent,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Write failed";
    console.error("Track error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
