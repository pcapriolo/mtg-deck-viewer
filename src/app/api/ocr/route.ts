import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const DECK_EXTRACTION_PROMPT = `Extract the complete Magic: The Gathering decklist from this screenshot.

LAYOUT TYPES (handle all):
- Stacked card images: cards in columns, copies stacked vertically with title bars peeking out. Count peek bars + bottom card.
- Grid with quantity badges: cards shown with "x4", "×4", or circled numbers. Use the badge number.
- Text list: card names as text (e.g., "4 Lightning Bolt").
- Mixed: any combination of the above.

READING CARD NAMES:
- Read from the TITLE BAR at the top of each card image.
- The same card may appear in multiple locations. Sum all copies.
- If a name is truncated, read as much as visible and mark with [partial].

READING QUANTITIES — BE PRECISE:
- If a card has a quantity badge (x4, ×3, etc.), read the NUMBER carefully. Common misreads: "2" vs "4", "3" vs "8". Look twice.
- If a card has NO quantity badge and is NOT stacked, it is exactly 1 copy.
- For stacked cards without badges: count every peek bar + the bottom card.
- Stack height confirms badge accuracy: x4 cards are noticeably taller stacks than x2.

MANDATORY CROSS-CHECK (do not skip):
After listing all cards, sum the mainboard total.
- If the image states a count (e.g., "60 cards"), your total MUST match.
- If it does NOT match, go back and re-read EVERY quantity. Find the discrepancy. Fix it before outputting.
- Standard: 60 mainboard, up to 15 sideboard. Commander: 100 cards.

OUTPUT FORMAT:
N Card Name
...
Sideboard
N Card Name
...

Output ONLY the corrected, verified decklist. No commentary, no card types, no set codes.
Read every name carefully — if uncertain, give your best reading.`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured. Set it in your environment variables." },
      { status: 500 }
    );
  }

  try {
    const { image } = await request.json();

    if (!image || typeof image !== "string") {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    // Extract base64 data and media type from data URL
    const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) {
      return NextResponse.json({ error: "Invalid image format. Expected base64 data URL." }, { status: 400 });
    }

    const mediaType = match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    const base64Data = match[2];

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: "text",
              text: DECK_EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    });

    // Extract text from response
    const textBlock = response.content.find((block) => block.type === "text");
    const decklist = textBlock?.text ?? "";

    return NextResponse.json({ decklist });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OCR failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
