import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const DECK_EXTRACTION_PROMPT = `You are a Magic: The Gathering decklist extractor. Your ONLY job is to output a decklist. Do NOT explain what you see. Do NOT describe the image. Do NOT add any commentary. Start your response with the first card line immediately.

SCAN THE ENTIRE IMAGE. Look at EVERY column, EVERY row, EVERY panel. Common layouts:
- MTG Arena deck builder: cards in columns (left/center) + sideboard text list (right panel)
- Web deck viewers: card images in a grid with quantity badges (x4, x3, etc.)
- Stacked layouts: cards stacked vertically, count peek bars + bottom card
- Text lists: "4 Lightning Bolt" format

READING CARD NAMES:
1. Read from the TITLE BAR at the top of each card image.
2. Scan left to right, top to bottom. Do NOT skip any column or any row.
3. LANDS ARE CARDS TOO — do not skip the land column. Count every land.
4. SPELLS BETWEEN COLUMNS — cards may appear between creature and land columns. Do not skip them.

CRITICAL — QUANTITY DEFAULTS TO 1:
Every card is 1 copy UNLESS you can see one of these:
- A visible "x4", "x3", "x2" text badge overlay on the card image
- Multiple peek bars above the card (stacked copies with visible title bars)
Do NOT infer quantities from context, card type, or what decks usually run.
If you cannot point to a specific visual indicator of quantity > 1, it is EXACTLY 1.
A single card image with no badge and no peek bars above it = 1 copy. Period.

READING QUANTITY BADGES:
- Read each badge number TWICE. Common misreads: "2" vs "4", "3" vs "8".
- Stack height confirms badge: x4 stacks are noticeably taller than x2.

ARENA-SPECIFIC:
- The rightmost panel labeled "Sideboard" contains a scrollable text list with "1x Card Name" format. Read EVERY entry.
- The main deck area has 4-5 columns of card stacks. Read ALL of them.
- Cards between columns (transition from spells to lands) are easy to miss — scan carefully.

CROSS-CHECK:
Sum your mainboard total. If the image shows a card count (e.g., "60/60 Cards"), your total MUST match.
If it doesn't match, re-scan every column and fix before outputting.

OUTPUT FORMAT (start IMMEDIATELY with the first card — no preamble):
N Card Name
N Card Name
...
Sideboard
N Card Name
N Card Name
...`;

const EVAL_PROMPT = `You are a quality checker for a Magic: The Gathering decklist extraction. You were given an image of a deck and produced the decklist below. Now verify it against the image.

EXTRACTED DECKLIST:
{decklist}

CHECK EACH ITEM:
1. QUANTITY HALLUCINATION: For every card with quantity > 1, verify you can see a visible "x4"/"x3"/"x2" badge or multiple stacked peek bars in the image. If a card shows NO badge and NO stacking, its quantity MUST be 1. This is the #1 error — inventing quantities for single cards.

2. MISSING CARDS: Scan every column left to right, top to bottom. Is there any card visible in the image that is NOT in the decklist? Pay special attention to:
   - Cards between columns (transition areas)
   - Single cards without badges (easy to overlook)
   - The bottom card in each column
   - Lands — count every single one

3. CARD COUNT: Sum the mainboard. Does it match the count shown in the image? If not, find the discrepancy.

4. SIDEBOARD: If the image has a sideboard panel, verify every entry is captured.

5. NAME ACCURACY: Are any card names misspelled or misread?

If you find ANY errors, output the CORRECTED decklist. If no errors found, output the original decklist unchanged.

OUTPUT FORMAT (corrected decklist only — no commentary, no explanation):
N Card Name
...
Sideboard
N Card Name
...`;

/**
 * Strip any commentary/preamble that Claude might add before the decklist.
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

  const deckLines = lines.slice(startIdx);

  const cleaned = deckLines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^sideboard$/i.test(trimmed)) return true;
    if (/^\d+[xX]?\s+\S/.test(trimmed)) return true;
    if (/^\d+\s*$/.test(trimmed)) return false;
    return false;
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
    const { image, imageUrl } = await request.json();

    if (!image && !imageUrl) {
      return NextResponse.json({ error: "No image or imageUrl provided" }, { status: 400 });
    }

    // Build the image source for the Anthropic API
    let imageSource: Anthropic.ImageBlockParam["source"];

    if (imageUrl && typeof imageUrl === "string") {
      // URL mode: fetch the image and convert to base64 (Anthropic API needs base64)
      const imgResponse = await fetch(imageUrl);
      if (!imgResponse.ok) {
        return NextResponse.json(
          { error: `Failed to fetch image from URL: ${imgResponse.status}` },
          { status: 400 }
        );
      }
      const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
      const buffer = await imgResponse.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const mediaType = contentType.split(";")[0].trim() as
        | "image/jpeg"
        | "image/png"
        | "image/gif"
        | "image/webp";
      imageSource = { type: "base64", media_type: mediaType, data: base64 };
    } else if (image && typeof image === "string") {
      // Base64 data URL mode
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
      imageSource = { type: "base64", media_type: mediaType, data: match[2] };
    } else {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const client = new Anthropic({ apiKey });

    // ── Pass 1: Extract decklist ──────────────────────────────
    const extractResponse = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: imageSource },
            { type: "text", text: DECK_EXTRACTION_PROMPT },
          ],
        },
      ],
    });

    const extractText =
      extractResponse.content.find((b) => b.type === "text")?.text ?? "";
    const firstPass = cleanResponse(extractText);

    // ── Pass 2: Eval — verify against the image ──────────────
    const evalPrompt = EVAL_PROMPT.replace("{decklist}", firstPass);

    const evalResponse = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: imageSource },
            { type: "text", text: evalPrompt },
          ],
        },
      ],
    });

    const evalText =
      evalResponse.content.find((b) => b.type === "text")?.text ?? "";
    const secondPass = cleanResponse(evalText);

    // Use the eval-corrected version if it produced valid output, otherwise first pass
    const decklist = secondPass.length > 0 ? secondPass : firstPass;

    return NextResponse.json({
      decklist,
      raw_pass1: extractText,
      raw_pass2: evalText,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OCR failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
