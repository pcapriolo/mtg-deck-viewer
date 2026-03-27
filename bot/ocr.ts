/**
 * Decklist OCR — uses Claude Vision to extract card names from screenshot images.
 *
 * Two-pass system (mirrors src/app/api/ocr/route.ts):
 *   Pass 1: Extract decklist with detailed prompt
 *   Pass 2: Eval — verify against the image and fix errors
 */

import Anthropic from "@anthropic-ai/sdk";

export interface OcrResult {
  decklist: string;
  expectedCount: number | null;
  actualCount: number;
  correctionRan: boolean;
  correctionAccepted: boolean;
  passCount: number;
  imageUrl: string;
}

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

READING QUANTITIES — TWO METHODS (detect which applies):

METHOD A — BADGE-BASED (deck builders with quantity overlays):
Cards have a visible badge (x4, x3, x2) on the card image.
1. Look for a badge overlay (usually bottom-right or top-right).
2. Read the badge number carefully — common misreads: "2" vs "4", "3" vs "8".
3. If NO badge and card is NOT stacked, quantity is 1.

METHOD B — STACKED CARD LAYOUTS (MTGGoldfish, MTGO, visual deck displays):
Cards are stacked vertically. Each copy peeks out showing its title bar. There are NO quantity badges.
The quantity = number of distinct title bar instances you can see for that card name.

COUNTING PROCEDURE (do this for EVERY card group):
1. Find the BOTTOM card — it shows the full card image including art and text.
2. Count upward from there — each thin peeking strip above it is +1 copy.
3. The bottom card itself is ALWAYS 1 copy. Peeking bars above = additional copies.
4. So: 0 bars above + full card = 1 copy. 1 bar + full card = 2. 2 bars + full card = 3. 3 bars + full card = 4.
5. Count the bars by looking at the LEFT EDGE of the stack — each bar creates a distinct horizontal line.

CRITICAL ERRORS TO AVOID:
- DO NOT count a single unstacked card as 4. If there is only ONE title bar and ONE card image with no stack, it is 1 copy.
- DO NOT confuse tall stacks (4 copies) with short stacks (2 copies). Actually count the bars.
- The SIDEBOARD section (usually rightmost column with vertical "SIDEBOARD" label) uses the same stacking — count those bars too.

For BOTH methods:
- NEVER guess quantities from context, card type, or what decks usually run.
- Basic lands CAN have 5+ copies.
- No non-basic card can have more than 4 copies.

LAND COLUMN — EXTRA CARE:
The rightmost column in deck builder layouts contains lands. These cards are often
displayed smaller with less visible badges. Read each land's badge THREE times.
Common land badge misreads:
- Reading x3 when the badge says x1 (single Mountain/Forest with no stack)
- Reading x1 when the badge says x3 or x5 (missing a clearly visible badge)
- Missing the badge on the bottom card in the column

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

const EVAL_PROMPT = `You are a quality checker for a Magic: The Gathering decklist extraction. The extraction below likely has QUANTITY ERRORS. Your job is to recount every card.

EXTRACTED DECKLIST:
{decklist}

STEP 1 — RECOUNT EVERY CARD (mandatory visual evidence):
For EACH card, you MUST describe what you physically see BEFORE writing a count.
DO NOT use your knowledge of what decks "usually run". ONLY count what is visible.

For each card, write exactly this format:
CARD: [name] | SEE: [describe exactly what you see — "single card, full art, no stack above" OR "3 peeking bars above + 1 full card at bottom"] | COUNT: [number] | EXTRACTED: [what pass 1 said]

Rules:
- If you see ONE card with full art and NO peeking title bars stacked above it → COUNT: 1. Period. It does not matter if this card is "usually a 4-of". You count what you SEE.
- If you see peeking title bars stacked above a full card → count bars + 1 for the bottom card.
- If you see a quantity badge (x4, x3) → read the badge.
- NEVER let card knowledge override visual evidence. A single visible card = 1 copy even if it's Lightning Bolt.
- IMPORTANT: Some powerful cards (Force of Will, Force of Negation, Brainstorm, etc.) may appear as 1-2 copies in certain decks. Do NOT assume they are 4-of. Count ONLY what you see.
- If your COUNT differs from EXTRACTED, flag it with CHANGED and explain what you see differently.

STEP 2 — MISSING CARDS:
Scan every column left to right, every row. Any card visible in the image NOT in the decklist?

STEP 3 — TOTAL CHECK:
Sum your corrected counts. If the image shows a total (e.g., "60/60 Cards"), verify match.

STEP 4 — NAME CHECK:
Any misspelled names? Fix them.

STEP 5 — DFC/SPLIT:
Any double-faced or split cards listed as two entries? Merge to one.

OUTPUT (after all verification above):
The corrected decklist only — no analysis, no commentary:
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
export function cleanResponse(text: string): string {
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
    // Strip the SUM: arithmetic line from eval pass
    if (/^sum[:\s]/i.test(trimmed)) return false;
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
export async function extractDecklistFromImage(imageUrl: string): Promise<OcrResult | null> {
  const anthropic = getClient();
  const { base64, mediaType } = await fetchImageAsBase64(imageUrl);

  const imageSource: Anthropic.ImageBlockParam["source"] = {
    type: "base64",
    media_type: mediaType,
    data: base64,
  };

  // Pass 1: Extract
  const extractMsg = await anthropic.messages.create({
    model: "claude-opus-4-6",
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

  let passCount = 1;

  // Pass 2: Eval — verify against the image
  const evalPrompt = EVAL_PROMPT.replace("{decklist}", firstPass);

  const evalMsg = await anthropic.messages.create({
    model: "claude-opus-4-6",
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
  let result = secondPass.length > 0 ? secondPass : firstPass;
  passCount = 2;

  // Pass 3 (conditional): Count correction
  // Check all text sources for an expected count (e.g., "60/60 Cards")
  const expectedCount = extractExpectedCount(extractText)
    ?? extractExpectedCount(evalText)
    ?? extractExpectedCount(firstPass);
  const actualCount = countCards(result);
  let correctionRan = false;
  let correctionAccepted = false;
  if (expectedCount && actualCount !== expectedCount) {
    correctionRan = true;
    passCount = 3;
    console.log(`   ⚠️  Count mismatch: got ${actualCount}, expected ${expectedCount}. Running correction pass...`);
    const corrected = await correctCountMismatch(anthropic, imageSource, result, actualCount, expectedCount);
    if (corrected) {
      const correctedCount = countCards(corrected);
      console.log(`   📊 Correction pass result: ${correctedCount} cards (was ${actualCount}, target ${expectedCount})`);
      if (Math.abs(correctedCount - expectedCount) < Math.abs(actualCount - expectedCount)) {
        result = corrected;
        correctionAccepted = true;
        console.log(`   ✅ Accepted correction: ${actualCount} → ${correctedCount}`);
      } else {
        console.log(`   ❌ Rejected correction (${correctedCount} not closer to ${expectedCount} than ${actualCount})`);
      }
    } else {
      console.log(`   ❌ Correction pass returned null`);
    }
  }

  const finalDecklist = await mergeSplitCards(result);
  return {
    decklist: finalDecklist,
    expectedCount,
    actualCount: countCards(finalDecklist),
    correctionRan,
    correctionAccepted,
    passCount,
    imageUrl,
  };
}

/**
 * Extract expected card count from text like "60/60 Cards", "60 Cards",
 * "expected: 60", or "image shows 60".
 */
export function extractExpectedCount(text: string): number | null {
  const patterns = [
    /(\d+)\/\d+\s*cards/i,          // "60/60 Cards"
    /expected[:\s]+(\d+)/i,          // "expected: 60"
    /image\s+shows?\s+(\d+)/i,      // "image shows 60"
    /should\s+be\s+(\d+)/i,         // "should be 60"
  ];
  for (const pat of patterns) {
    const match = text.match(pat);
    if (match) {
      const n = parseInt(match[1]);
      if (n >= 40 && n <= 100) return n; // reasonable deck size
    }
  }
  return null;
}

/**
 * Count total cards in a decklist string.
 */
export function countCards(decklist: string): number {
  let total = 0;
  let inSideboard = false;
  for (const line of decklist.split("\n")) {
    const trimmed = line.trim().toLowerCase();
    if (/^sideboard$/i.test(trimmed)) { inSideboard = true; continue; }
    if (inSideboard) continue;
    const match = line.match(/^(\d+)\s/);
    if (match) total += parseInt(match[1]);
  }
  return total;
}

/**
 * Pass 3: Targeted count correction.
 * When the total is wrong, ask Claude to find exactly which cards have wrong quantities.
 */
async function correctCountMismatch(
  anthropic: Anthropic,
  imageSource: Anthropic.ImageBlockParam["source"],
  decklist: string,
  actualCount: number,
  expectedCount: number
): Promise<string | null> {
  const diff = expectedCount - actualCount;
  const direction = diff > 0 ? "MISSING" : "EXTRA";

  const prompt = `PROBLEM: This decklist has ${actualCount} mainboard cards but the image shows ${expectedCount}. There are ${Math.abs(diff)} ${direction.toLowerCase()} cards.

CURRENT DECKLIST:
${decklist}

TASK: Find which cards have wrong quantities.

For EACH card in the decklist, examine its badge in the image ONE AT A TIME:
- [Card Name]: badge says [x?], decklist says [N], ${actualCount > expectedCount ? "reduce" : "increase"} if wrong

Focus especially on LANDS (rightmost column) — they are the most commonly misread.
Basic lands (Mountain, Forest, etc.) can have any quantity including 1 or 5+.

After checking every card, verify your corrected total equals ${expectedCount}.
If it doesn't, re-examine until it does.

Output ONLY the corrected decklist:
N Card Name
...`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: imageSource },
          { type: "text", text: prompt },
        ],
      }],
    });

    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as any).text)
      .join("")
      .trim();

    return cleanResponse(text);
  } catch {
    return null;
  }
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

/** Minimum mainboard cards required to accept an OCR result as a real decklist. */
export const MIN_MAINBOARD_CARDS = 10;

/**
 * Given a list of OcrResults (some may be null), return the first one with
 * >= MIN_MAINBOARD_CARDS mainboard cards, or the one with the highest card count,
 * or null if the list is empty / all null.
 *
 * This is the selection algorithm for multi-image fallback — exported for testing.
 */
export function selectBestOcrResult(results: Array<OcrResult | null>): OcrResult | null {
  let best: OcrResult | null = null;
  for (const result of results) {
    if (!result) continue;
    const count = countCards(result.decklist);
    if (count >= MIN_MAINBOARD_CARDS) return result;
    if (!best || count > countCards(best.decklist)) best = result;
  }
  return best;
}

/**
 * Try to extract a decklist from multiple image URLs.
 * Tries each URL in order. Accepts the first result with >= 10 mainboard cards.
 * If no URL yields enough cards, returns the best result seen (highest card count),
 * or null if nothing was extracted at all.
 *
 * This handles the common failure mode where image[0] is card art and yields
 * too few cards, while image[1] or image[2] contains the actual decklist.
 */
export async function extractDecklistFromImages(imageUrls: string[]): Promise<OcrResult | null> {
  let best: OcrResult | null = null;

  for (const url of imageUrls) {
    let result: OcrResult | null = null;
    try {
      result = await extractDecklistFromImage(url);
    } catch (err) {
      console.error(`OCR failed for ${url}:`, err);
      continue;
    }

    if (!result) continue;

    const mainCount = countCards(result.decklist);
    if (mainCount >= MIN_MAINBOARD_CARDS) return result;

    // Keep best result seen so far (highest card count)
    if (!best || mainCount > countCards(best.decklist)) {
      best = result;
    }
    console.log(`   ⚠️  OCR image ${url} yielded only ${mainCount} mainboard cards — trying next image`);
  }

  return best;
}
