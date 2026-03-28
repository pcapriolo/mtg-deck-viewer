import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.caseCount || body.cardNameAccuracy == null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const run = await prisma.evalRun.create({
      data: {
        caseCount: body.caseCount,
        cardNameAccuracy: body.cardNameAccuracy,
        quantityAccuracy: body.quantityAccuracy,
        countMatchRate: body.countMatchRate,
        scryfallResolved: body.scryfallResolved,
        triggeredBy: body.triggeredBy ?? null,
        commitSha: body.commitSha ?? null,
        details: body.details ?? null,
      },
    });

    return NextResponse.json({ ok: true, id: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Write failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, parseInt(searchParams.get("limit") || "30", 10) || 30);
    const days = parseInt(searchParams.get("days") || "90", 10) || 90;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const runs = await prisma.evalRun.findMany({
      where: { ranAt: { gte: since } },
      orderBy: { ranAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Read failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
