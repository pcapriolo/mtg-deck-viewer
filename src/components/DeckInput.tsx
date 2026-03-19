"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface DeckInputProps {
  onSubmit: (input: string, type: "text") => void;
  loading: boolean;
}

const SAMPLE_DECK = `4 Monastery Swiftspear
4 Soul-Scar Mage
4 Goblin Guide
4 Eidolon of the Great Revel
4 Lightning Bolt
4 Lava Spike
4 Rift Bolt
4 Searing Blaze
4 Skullcrack
2 Light Up the Stage
2 Shard Volley
4 Inspiring Vantage
4 Sacred Foundry
2 Sunbaked Canyon
2 Fiery Islet
8 Mountain

Sideboard
2 Path to Exile
2 Rest in Peace
3 Sanctifier en-Vec
2 Roiling Vortex
2 Smash to Smithereens
2 Deflecting Palm
2 Kor Firewalker`;

const DECKLIST_LINE = /^\d+\s*[xX]?\s+\S/;

function looksLikeDecklist(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  const matches = lines.filter((l) => DECKLIST_LINE.test(l));
  return matches.length >= 2;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function DeckInput({ onSubmit, loading }: DeckInputProps) {
  const [text, setText] = useState("");
  const [pastePrompt, setPastePrompt] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [ocrMessage, setOcrMessage] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isProcessingOcr = ocrProgress !== null;

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  const clearPrompt = useCallback(() => {
    setPastePrompt(false);
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  }, []);

  const handleSubmit = useCallback(() => {
    if (text.trim()) {
      clearPrompt();
      setOcrMessage(null);
      setOcrError(null);
      onSubmit(text.trim(), "text");
    }
  }, [text, onSubmit, clearPrompt]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      if (pastePrompt) {
        clearPrompt();
      }
    },
    [pastePrompt, clearPrompt]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pasted = e.clipboardData.getData("text/plain");
      if (pasted && looksLikeDecklist(pasted)) {
        setPastePrompt(true);
        if (dismissTimer.current) clearTimeout(dismissTimer.current);
        dismissTimer.current = setTimeout(() => {
          setPastePrompt(false);
          dismissTimer.current = null;
        }, 5000);
      }
    },
    []
  );

  const processImage = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;

    setOcrError(null);
    setOcrMessage(null);
    setOcrProgress(0);

    try {
      const dataUrl = await fileToDataUrl(file);
      const { extractDecklistFromImage } = await import("@/lib/ocr");
      const extracted = await extractDecklistFromImage(dataUrl, setOcrProgress);

      const lines = extracted.split("\n").filter((l) => l.trim());
      setText(extracted);
      setOcrMessage(`Extracted ${lines.length} lines from image. Review and edit before submitting.`);
    } catch {
      setOcrError("Could not read image. Try a clearer screenshot.");
    } finally {
      setOcrProgress(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) processImage(file);
    },
    [processImage]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processImage(file);
      // Reset so the same file can be selected again
      e.target.value = "";
    },
    [processImage]
  );

  const loadSample = useCallback(() => {
    setText(SAMPLE_DECK);
    clearPrompt();
    setOcrMessage(null);
    setOcrError(null);
  }, [clearPrompt]);

  return (
    <div className="space-y-4">
      {/* Text input */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-300">Paste a decklist</label>
          <button
            onClick={loadSample}
            className="text-xs text-amber-500 hover:text-amber-400 transition-colors"
          >
            Load sample deck
          </button>
        </div>
        <textarea
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={`4 Lightning Bolt\n4 Monastery Swiftspear\n2 Eidolon of the Great Revel\n...`}
          className="w-full h-48 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 font-mono resize-none focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/25"
        />

        {pastePrompt && (
          <div className="mt-2 flex items-center gap-2 text-sm text-gray-300 animate-in fade-in">
            <span>Looks like a decklist —</span>
            <button
              onClick={handleSubmit}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded transition-colors"
            >
              View it?
            </button>
          </div>
        )}
      </div>

      {/* Image drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !isProcessingOcr && fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg px-4 py-6 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-amber-500 bg-amber-500/10"
            : "border-gray-700 hover:border-gray-500"
        } ${isProcessingOcr ? "pointer-events-none opacity-60" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        {isProcessingOcr ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-300">Analyzing image... {ocrProgress}%</p>
            <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${ocrProgress}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            Drop a deck screenshot or{" "}
            <span className="text-amber-500 underline">browse</span>
          </p>
        )}
      </div>

      {/* OCR result message */}
      {ocrMessage && (
        <div className="p-3 bg-green-900/20 border border-green-800/40 rounded-lg text-sm text-green-300">
          {ocrMessage}
        </div>
      )}

      {/* OCR error */}
      {ocrError && (
        <div className="p-3 bg-red-900/20 border border-red-800/40 rounded-lg text-sm text-red-300">
          {ocrError}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={loading || isProcessingOcr || !text.trim()}
        className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
      >
        {loading ? "Loading cards..." : "View Deck"}
      </button>
    </div>
  );
}
