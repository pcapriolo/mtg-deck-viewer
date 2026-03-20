/**
 * Context reconciliation — lightweight Claude text call that synthesizes
 * tweet text + OCR metadata + card list into the best deck name,
 * hallmark card, and author.
 *
 * Cost: ~$0.001 per call (text-only, no vision)
 * Latency: ~1-2 seconds
 */

import Anthropic from "@anthropic-ai/sdk";

export interface DeckContext {
  deckName: string | null;
  hallmarkCard: string | null;
  author: string | null;
}

const RECONCILE_PROMPT = `You are extracting deck metadata from a Magic: The Gathering tweet thread.

Thread text (newest first):
{threadTexts}

Image OCR deck name: {ocrDeckName}
Image OCR author: {ocrAuthor}
Cards in deck (sample): {cardNames}

Extract as JSON:
- deckName: The best human-readable name for this deck. Prefer natural language from tweets over generic UI labels. null if no name in any signal.
- hallmarkCard: The specific card being featured or highlighted in the tweet text (e.g., "w/ Michelangelo's Technique" → "Michelangelo's Technique"). MUST be one of the cards listed above. null if no card is explicitly featured.
- author: The deck creator, ONLY if explicitly credited in the tweet text ("by @X", "credit to X", "X's deck") or visible in the image OCR. null if ambiguous or not mentioned. NEVER assume the tweet poster is the creator.

Rules:
- Do NOT invent information. Only extract what is clearly stated.
- If tweet text and OCR disagree on deck name, prefer the tweet text (more natural).
- If no deck name exists in any signal, return null — do not guess.
- hallmarkCard must exactly match one of the card names listed above.

Respond with ONLY a JSON object, no explanation:
{"deckName": ..., "hallmarkCard": ..., "author": ...}`;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Reconcile all available signals into the best deck metadata.
 * Falls back to OCR-only metadata if the API call fails.
 */
export async function reconcileContext(
  threadTexts: string[],
  ocrDeckName: string | null,
  ocrAuthor: string | null,
  cardNames: string[]
): Promise<DeckContext> {
  // If no thread text and no OCR metadata, nothing to reconcile
  const hasThreadText = threadTexts.some((t) => t.trim().length > 0);
  if (!hasThreadText && !ocrDeckName && !ocrAuthor) {
    return { deckName: null, hallmarkCard: null, author: null };
  }

  // If only OCR metadata and no thread text, skip the API call
  if (!hasThreadText) {
    return {
      deckName: ocrDeckName,
      hallmarkCard: null,
      author: ocrAuthor,
    };
  }

  const prompt = RECONCILE_PROMPT
    .replace("{threadTexts}", threadTexts.map((t, i) => `${i + 1}. ${t}`).join("\n"))
    .replace("{ocrDeckName}", ocrDeckName ?? "none")
    .replace("{ocrAuthor}", ocrAuthor ?? "none")
    .replace("{cardNames}", cardNames.slice(0, 10).join(", "));

  try {
    const anthropic = getClient();
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as any).text)
      .join("")
      .trim();

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("   ⚠️  Reconciliation returned non-JSON:", text);
      return { deckName: ocrDeckName, hallmarkCard: null, author: ocrAuthor };
    }

    const parsed = JSON.parse(jsonMatch[0]) as DeckContext;

    // Validate hallmarkCard is in the card list
    if (parsed.hallmarkCard) {
      const hallmarkLower = parsed.hallmarkCard.toLowerCase();
      const validCard = cardNames.some(
        (c) => c.toLowerCase() === hallmarkLower || c.toLowerCase().includes(hallmarkLower) || hallmarkLower.includes(c.toLowerCase())
      );
      if (!validCard) {
        parsed.hallmarkCard = null;
      }
    }

    return {
      deckName: parsed.deckName || null,
      hallmarkCard: parsed.hallmarkCard || null,
      author: parsed.author || null,
    };
  } catch (err) {
    console.error("   ⚠️  Reconciliation failed, using OCR metadata:", err);
    return { deckName: ocrDeckName, hallmarkCard: null, author: ocrAuthor };
  }
}
