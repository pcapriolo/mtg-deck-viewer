/**
 * Decklist OCR — uses Claude Vision to extract card names from screenshot images.
 *
 * Sends the image to Claude with a focused prompt that returns a clean decklist
 * in standard "4 Card Name" format, ready to feed into the parser.
 */

import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are a Magic: The Gathering decklist OCR tool. Given an image of a decklist (screenshot from MTG Arena, MTGO, a website, or handwritten), extract every card name and quantity.

Output ONLY the decklist in this exact format, one card per line:
<quantity> <card name>

Rules:
- Use the standard English card name (correct any OCR typos you can infer)
- If you see a sideboard section, output a blank line then "Sideboard" on its own line before the sideboard cards
- If you see a companion or commander, output those sections the same way
- Do NOT include set codes, collector numbers, or any other metadata
- Do NOT include any commentary, explanation, or markdown
- If the image is not a decklist, respond with exactly: NOT_A_DECKLIST`;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Extract a decklist from an image URL.
 * Returns the raw decklist text, or null if the image isn't a decklist.
 */
export async function extractDecklistFromImage(imageUrl: string): Promise<string | null> {
  const anthropic = getClient();

  // Fetch the image and convert to base64
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);

  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const contentType = response.headers.get("content-type") ?? "image/jpeg";

  const mediaType = contentType.startsWith("image/png") ? "image/png"
    : contentType.startsWith("image/webp") ? "image/webp"
    : contentType.startsWith("image/gif") ? "image/gif"
    : "image/jpeg";

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          {
            type: "text",
            text: "Extract the decklist from this image.",
          },
        ],
      },
    ],
  });

  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as any).text)
    .join("")
    .trim();

  if (text === "NOT_A_DECKLIST" || !text) return null;
  return text;
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
