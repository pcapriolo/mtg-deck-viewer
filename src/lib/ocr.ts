/**
 * Extract a decklist from a deck screenshot using Claude Vision API.
 * Calls the /api/ocr server route which handles the Anthropic API call.
 */
export async function extractDecklistFromImage(
  imageData: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  // Show indeterminate progress
  onProgress?.(10);

  const response = await fetch("/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageData }),
  });

  onProgress?.(80);

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: "OCR request failed" }));
    throw new Error(data.error || `OCR failed with status ${response.status}`);
  }

  const data = await response.json();
  onProgress?.(100);

  if (!data.decklist || data.decklist.trim().length === 0) {
    throw new Error("Could not extract any card names from the image. Try a clearer screenshot.");
  }

  return data.decklist;
}
