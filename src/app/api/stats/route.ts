import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = Math.max(1, parseInt(searchParams.get("hours") || "24", 10) || 24);
    const limit = Math.max(1, parseInt(searchParams.get("limit") || "100", 10) || 100);
    const conversationId = searchParams.get("conversationId");
    const tweetId = searchParams.get("tweetId");

    // Quick dedup check — returns just alreadyReplied flag
    if (conversationId) {
      const existing = await prisma.interaction.findFirst({
        where: { conversationId, replySent: true },
        select: { id: true },
      });
      return NextResponse.json({ alreadyReplied: !!existing });
    }

    if (tweetId) {
      const existing = await prisma.interaction.findFirst({
        where: { tweetId, replySent: true },
        select: { id: true },
      });
      return NextResponse.json({ alreadyReplied: !!existing });
    }

    // Full stats query
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const interactions = await prisma.interaction.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Compute summary
    const allInWindow = await prisma.interaction.findMany({
      where: { createdAt: { gte: since } },
      select: {
        ocrSuccess: true,
        replySent: true,
        totalTimeMs: true,
        ocrTimeMs: true,
        replyVariant: true,
        ocrCardsExtracted: true,
      },
    });

    const total = allInWindow.length;
    const successes = allInWindow.filter((i) => i.replySent).length;
    const failures = total - successes;
    const avgTotalTimeMs = total > 0
      ? allInWindow.reduce((sum, i) => sum + i.totalTimeMs, 0) / total
      : null;
    const avgOcrTimeMs = total > 0
      ? allInWindow.reduce((sum, i) => sum + i.ocrTimeMs, 0) / total
      : null;

    // Variant distribution
    const variantDistribution: Record<string, number> = {};
    for (const i of allInWindow) {
      const v = i.replyVariant ?? "unknown";
      variantDistribution[v] = (variantDistribution[v] ?? 0) + 1;
    }

    return NextResponse.json({
      interactions,
      summary: {
        total,
        successes,
        failures,
        avgTotalTimeMs,
        avgOcrTimeMs,
        variantDistribution,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read metrics";
    console.error("Stats error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
