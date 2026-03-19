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

export default function DeckInput({ onSubmit, loading }: DeckInputProps) {
  const [text, setText] = useState("");
  const [pastePrompt, setPastePrompt] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      // Dismiss paste prompt if user types more
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
        // Auto-dismiss after 5 seconds
        if (dismissTimer.current) clearTimeout(dismissTimer.current);
        dismissTimer.current = setTimeout(() => {
          setPastePrompt(false);
          dismissTimer.current = null;
        }, 5000);
      }
    },
    []
  );

  const loadSample = useCallback(() => {
    setText(SAMPLE_DECK);
    clearPrompt();
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

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={loading || !text.trim()}
        className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
      >
        {loading ? "Loading cards..." : "View Deck"}
      </button>
    </div>
  );
}
