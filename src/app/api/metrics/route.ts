import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.tweetId || !body.timestamp) {
      return NextResponse.json(
        { error: "Missing required fields: tweetId and timestamp" },
        { status: 400 }
      );
    }

    await prisma.interaction.create({
      data: {
        tweetId: body.tweetId,
        conversationId: body.conversationId ?? null,
        authorId: body.authorId ?? null,
        authorUsername: body.authorUsername ?? null,
        tweetText: body.tweetText?.slice(0, 280) ?? null,
        imageCount: body.imageCount ?? 0,
        imageUrl: body.imageUrl ?? null,

        ocrSuccess: body.ocrSuccess ?? false,
        ocrPassCount: body.ocrPassCount ?? 0,
        ocrCardsExtracted: body.ocrCardsExtracted ?? 0,
        ocrTimeMs: body.ocrTimeMs ?? 0,
        ocrExpectedCount: body.ocrExpectedCount ?? null,
        ocrCorrectionRan: body.ocrCorrectionRan ?? false,
        ocrCorrectionAccepted: body.ocrCorrectionAccepted ?? false,

        scryfallCardsResolved: body.scryfallCardsResolved ?? 0,
        scryfallCardsNotFound: body.scryfallCardsNotFound ?? [],
        scryfallTimeMs: body.scryfallTimeMs ?? 0,

        replySent: body.replySent ?? false,
        replyTweetId: body.replyTweetId ?? null,
        replyVariant: body.replyFormatVariant ?? null,
        replyTimeMs: body.replyTimeMs ?? 0,

        deckName: body.deckName ?? null,
        deckUrl: body.deckUrl ?? null,
        decklistText: body.decklistText ?? null,
        mainboardCount: body.mainboardCount ?? 0,
        sideboardCount: body.sideboardCount ?? 0,

        totalTimeMs: body.totalTimeMs ?? 0,
        utmId: body.utmId ?? null,

        healingRan: body.healingRan ?? false,
        healingAccepted: body.healingAccepted ?? false,

        createdAt: new Date(body.timestamp),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Write failed";
    console.error("Metrics write error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
