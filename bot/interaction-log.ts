/**
 * Interaction logging — POST metrics to the web app's /api/metrics endpoint.
 * Fire-and-forget: never crash the bot over logging failures.
 */

export interface InteractionLog {
  id: string;
  timestamp: string;
  tweetId: string;
  authorId: string;
  authorUsername: string;
  tweetText: string;
  imageCount: number;
  ocrSuccess: boolean;
  ocrPassCount: number;
  ocrCardsExtracted: number;
  ocrTimeMs: number;
  ocrErrors: string[];
  scryfallCardsResolved: number;
  scryfallCardsNotFound: string[];
  scryfallTimeMs: number;
  replySent: boolean;
  replyTweetId?: string;
  replyFormatVariant: string;
  replyTimeMs: number;
  totalTimeMs: number;
  deckName?: string;
  mainboardCount: number;
  sideboardCount: number;
  utmId: string;
  errors: Array<{ type: string; message: string }>;
}

const DECK_VIEWER_URL = process.env.DECK_VIEWER_URL ?? "http://localhost:3000";

export async function logInteraction(log: InteractionLog): Promise<void> {
  try {
    // Truncate tweetText to 280 chars
    const payload = {
      ...log,
      tweetText: log.tweetText.slice(0, 280),
    };

    await fetch(`${DECK_VIEWER_URL}/api/metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("Failed to log interaction:", err);
  }
}
