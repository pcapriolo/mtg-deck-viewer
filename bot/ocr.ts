/**
 * Decklist OCR — uses Claude Vision to extract card names from screenshot images.
 *
 * Two-pass system (mirrors src/app/api/ocr/route.ts):
 *   Pass 1: Extract decklist with detailed prompt
 *   Pass 2: Eval — verify against the image and fix errors
 */

import Anthropic from "@anthropic-ai/sdk";

const EXTRACTION_PROMPT = `You are a Magic: The Gathering decklist extractor. Your ONLY job is to output a decklist. Do NOT explain what you see. Do NOT describe the image. Do NOT add any commentary. Start your response with the first card line immediately.

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
5. Card names may contain accents, diacritics, commas, apostrophes, hyphens, and slashes (//). These are real names — include special characters exactly as written on the card. Do not skip a card because its name looks unusual.
6. EVERY card visible in the image must appear in your output. If you can see a card's title bar, it must be listed.

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

DOUBLE-FACED CARDS (DFC / SPLIT CARDS / TRANSFORM):
- Some cards show BOTH faces in the image (front + back). Only count them ONCE using the FRONT face name.
- DFC back faces may appear rotated sideways or adjacent to their front face. Do NOT count them as separate cards.
- Split cards like "X // Y" show both halves — only list ONCE as "X // Y", never as two separate entries.
- Common DFC pairs: "X // Y" — only list the front face name or the full "X // Y" name, never both separately.

LEGALITY CHECK:
- No non-basic card can have more than 4 copies. If you count 5+ of any card that is NOT a basic land (Plains, Island, Swamp, Mountain, Forest), you miscounted — recount that card.
- Basic lands CAN have more than 4 copies.

CROSS-CHECK:
Sum your mainboard total. If the image shows a card count (e.g., "60/60 Cards"), your total MUST match.
If it doesn't match, re-scan every column and fix before outputting.

DECK METADATA (output BEFORE the card list):
If a DECK NAME is visible in the image (title bar, header, deck builder label), output it as the FIRST line:
Name: Deck Name Here
If a CREATOR/AUTHOR username is visible in the deck builder UI, output it on the next line:
Author: Creator Name
Do NOT invent a name or author — only include if clearly visible in the image.

OUTPUT FORMAT (start IMMEDIATELY — no preamble):
Name: Deck Name (if visible)
Author: Creator (if visible)
N Card Name
N Card Name
...
Sideboard
N Card Name
...`;

const EVAL_PROMPT = `You are a quality checker for a Magic: The Gathering decklist extraction. You were given an image of a deck and produced the decklist below. Now verify it against the image.

EXTRACTED DECKLIST:
{decklist}

CHECK EACH ITEM:
1. QUANTITY HALLUCINATION: For every card with quantity > 1, verify you can see a visible "x4"/"x3"/"x2" badge or multiple stacked peek bars in the image. If a card shows NO badge and NO stacking, its quantity MUST be 1. This is the #1 error — inventing quantities for single cards.

2. LEGALITY: No non-basic card can have more than 4 copies. If any card has 5+, it is miscounted — look at the image again and fix it. Basic lands (Plains, Island, Swamp, Mountain, Forest) CAN exceed 4.

3. DOUBLE-FACED CARDS / SPLIT CARDS: If a card's back face or second half appears in the image (rotated sideways or adjacent), do NOT count it as a separate card. Only count front faces. If you listed the same DFC/split card as both "Front Name" and "Back Name", merge them into one entry using the full name "Front // Back".

4. MISSING CARDS: Scan every column left to right, top to bottom. Is there any card visible in the image that is NOT in the decklist? Pay special attention to:
   - Cards between columns (transition areas)
   - Single cards without badges (easy to overlook)
   - The bottom card in each column
   - Lands — count every single one
   - Cards with accents or diacritics in names — these are real card names, not OCR artifacts

5. CARD COUNT: Sum the mainboard. Does it match the count shown in the image? If not, find the discrepancy.

6. SIDEBOARD: If the image has a sideboard panel, verify every entry is captured.

7. NAME ACCURACY: Are any card names misspelled or misread?

8. DECK NAME & AUTHOR: If the extracted list includes "Name:" or "Author:" lines, verify they match text visible in the image. Remove if hallucinated. Preserve if accurate.

If you find ANY errors, output the CORRECTED decklist. If no errors found, output the original decklist unchanged.

OUTPUT FORMAT (corrected decklist only — no commentary, no explanation):
N Card Name
...
Sideboard
N Card Name
...`;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Strip any commentary/preamble that Claude might add before the decklist.
 */
function cleanResponse(text: string): string {
  const lines = text.split("\n");

  // Find the first meaningful line (Name/Author metadata or card line)
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^\d+\s+\S/.test(trimmed) || /^(name|author)[:\s]/i.test(trimmed)) {
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
    if (/^(name|author)[:\s]/i.test(trimmed)) return true;
    return false;
  });

  return cleaned.join("\n").trim();
}

/**
 * Fetch an image and return base64 + media type for Anthropic API.
 */
async function fetchImageAsBase64(imageUrl: string): Promise<{
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}> {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);

  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const contentType = response.headers.get("content-type") ?? "image/jpeg";

  const mediaType = contentType.startsWith("image/png") ? "image/png" as const
    : contentType.startsWith("image/webp") ? "image/webp" as const
    : contentType.startsWith("image/gif") ? "image/gif" as const
    : "image/jpeg" as const;

  return { base64, mediaType };
}

/**
 * Extract a decklist from an image URL using two-pass OCR.
 * Pass 1: Extract with detailed prompt.
 * Pass 2: Eval — verify against the image and fix errors.
 * Returns the cleaned decklist text, or null if the image isn't a decklist.
 */
export async function extractDecklistFromImage(imageUrl: string): Promise<string | null> {
  const anthropic = getClient();
  const { base64, mediaType } = await fetchImageAsBase64(imageUrl);

  const imageSource: Anthropic.ImageBlockParam["source"] = {
    type: "base64",
    media_type: mediaType,
    data: base64,
  };

  // Pass 1: Extract
  const extractMsg = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: imageSource },
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  const extractText = extractMsg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as any).text)
    .join("")
    .trim();

  if (extractText === "NOT_A_DECKLIST" || !extractText) return null;

  const firstPass = cleanResponse(extractText);
  if (!firstPass) return null;

  // Pass 2: Eval — verify against the image
  const evalPrompt = EVAL_PROMPT.replace("{decklist}", firstPass);

  const evalMsg = await anthropic.messages.create({
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

  const evalText = evalMsg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as any).text)
    .join("")
    .trim();

  const secondPass = cleanResponse(evalText);

  const result = secondPass.length > 0 ? secondPass : firstPass;
  return mergeSplitCards(result);
}

/**
 * Post-process: detect split/DFC card halves listed separately and merge them.
 * Uses Scryfall to look up each card — if Scryfall returns a card with "//" in
 * its name, we know it's a split/DFC card and can merge both halves.
 */
async function mergeSplitCards(decklist: string): Promise<string> {
  const lines = decklist.split("\n");
  const entries: Array<{ qty: number; name: string; raw: string }> = [];
  const nonCardLines: Array<{ idx: number; raw: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\d+)x?\s+(.+)/i);
    if (match) {
      entries.push({ qty: parseInt(match[1]), name: match[2].trim(), raw: lines[i] });
    } else {
      nonCardLines.push({ idx: i, raw: lines[i] });
    }
  }

  // Look up all card names via Scryfall to find their canonical names
  const names = entries.map((e) => e.name);
  const canonicalMap = new Map<string, string>();

  try {
    // Batch lookup via Scryfall /cards/collection
    const identifiers = names.map((n) => ({ name: n }));
    // Scryfall allows 75 per request
    for (let i = 0; i < identifiers.length; i += 75) {
      const batch = identifiers.slice(i, i + 75);
      const resp = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: batch }),
      });
      if (resp.ok) {
        const data = await resp.json() as any;
        for (const card of data.data ?? []) {
          // Map ALL matching names to the canonical name (handles both halves of split cards)
          for (const n of names) {
            if (
              n.toLowerCase() === card.name.toLowerCase() ||
              card.name.toLowerCase().startsWith(n.toLowerCase() + " //") ||
              card.name.toLowerCase().endsWith("// " + n.toLowerCase())
            ) {
              canonicalMap.set(n.toLowerCase(), card.name);
            }
          }
        }
      }
      // Rate limit courtesy
      if (i + 75 < identifiers.length) await new Promise((r) => setTimeout(r, 100));
    }
  } catch {
    // If Scryfall fails, return as-is
    return decklist;
  }

  // Group entries by canonical name — merge split card halves
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(\d+)x?\s+(.+)/i);
    if (!match) {
      // Non-card line (Sideboard header, blank line)
      result.push(line);
      continue;
    }

    const qty = parseInt(match[1]);
    const name = match[2].trim();
    const canonical = canonicalMap.get(name.toLowerCase()) ?? name;
    const key = canonical.toLowerCase();

    if (seen.has(key)) continue; // Skip duplicate half of split card
    seen.add(key);
    result.push(`${qty} ${canonical}`);
  }

  return result.join("\n");
}

/**
 * Try to extract a decklist from multiple image URLs.
 * Returns the first successful extraction, or null.
 */
export async function extractDecklistFromImages(imageUrls: string[]): Promise<string | null> {
  for (const url of imageUrls) {
    try {
      const result = await extractDecklistFromImage(url);
      if (result) return result;
    } catch (err) {
      console.error(`OCR failed for ${url}:`, err);
    }
  }
  return null;
}
