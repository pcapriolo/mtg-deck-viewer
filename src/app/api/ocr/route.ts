import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const DECK_EXTRACTION_PROMPT = `You are a Magic: The Gathering decklist extractor. Your ONLY job is to output a decklist. Do NOT explain what you see. Do NOT describe the image. Do NOT add any commentary. Start your response with the first card line immediately.

SCAN THE ENTIRE IMAGE. Look at EVERY column, EVERY row, EVERY panel. Common layouts:
- MTG Arena deck builder: cards in columns (left/center) + sideboard text list (right panel)
- Web deck viewers: card images in a grid with quantity badges (x4, x3, etc.)
- Stacked layouts: cards stacked vertically, count peek bars + bottom card
- Text lists: "4 Lightning Bolt" format

READING RULES:
1. Read card names from the TITLE BAR at the top of each card image.
2. For quantity badges (x4, ×3, circled numbers): use the badge number.
3. No badge and not stacked = exactly 1 copy.
4. For stacked cards: count every visible peek bar + the bottom card.
5. Same card in multiple columns = sum all copies.
6. Scan left to right, top to bottom. Do NOT skip any column or any row.
7. LANDS ARE CARDS TOO — do not skip the land column. Count every land.

ARENA-SPECIFIC:
- The rightmost panel labeled "Sideboard" contains a scrollable text list with "1x Card Name" format. Read EVERY entry.
- The main deck area has 4-5 columns of card stacks. Read ALL of them.
- Look for the total card count (e.g., "60/60 Cards") and verify your extraction matches.

QUANTITY PRECISION:
- Read each number TWICE. Common misreads: "2" vs "4", "3" vs "8".
- Stack height confirms quantity: x4 stacks are taller than x2.

CROSS-CHECK:
Sum your mainboard total. If the image shows a card count, your total MUST match.
If it doesn't match, re-scan and fix before outputting.

OUTPUT FORMAT (start IMMEDIATELY with the first card — no preamble):
N Card Name
N Card Name
...
Sideboard
N Card Name
N Card Name
...`;

/**
 * Strip any commentary/preamble that Claude might add before the decklist.
 * Finds the first line that looks like a card entry (starts with a number)
 * and returns everything from there.
 */
function cleanResponse(text: string): string {
  const lines = text.split("\n");

  // Find the first line that looks like a card entry: "N Card Name"
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\d+\s+\S/.test(lines[i].trim())) {
      startIdx = i;
      break;
    }
  }

  // Take everything from the first card line onward
  const deckLines = lines.slice(startIdx);

  // Filter: keep only lines that are card entries, "Sideboard" header, or blank
  const cleaned = deckLines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true; // keep blank lines (section separators)
    if (/^sideboard$/i.test(trimmed)) return true;
    if (/^\d+[xX]?\s+\S/.test(trimmed)) return true; // "4 Card Name" or "4x Card Name"
    if (/^\d+\s*$/.test(trimmed)) return false; // bare numbers
    return false; // skip commentary
  });

  return cleaned.join("\n").trim();
}

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
      return NextResponse.json(
        { error: "Invalid image format. Expected base64 data URL." },
        { status: 400 }
      );
    }

    const mediaType = match[1] as
      | "image/jpeg"
      | "image/png"
      | "image/gif"
      | "image/webp";
    const base64Data = match[2];

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
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
    const rawText = textBlock?.text ?? "";

    // Clean any commentary/preamble from the response
    const decklist = cleanResponse(rawText);

    return NextResponse.json({ decklist, raw: rawText });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OCR failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
