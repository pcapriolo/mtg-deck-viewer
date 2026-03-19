"use client";

import { useState, useCallback } from "react";

interface DeckInputProps {
  onSubmit: (input: string, type: "text" | "image") => void;
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

export default function DeckInput({ onSubmit, loading }: DeckInputProps) {
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const handleSubmit = useCallback(() => {
    if (text.trim()) {
      onSubmit(text.trim(), "text");
    }
  }, [text, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);

      const file = e.dataTransfer.files[0];
      if (file?.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
          onSubmit(reader.result as string, "image");
        };
        reader.readAsDataURL(file);
      }
    },
    [onSubmit]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file?.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
          onSubmit(reader.result as string, "image");
        };
        reader.readAsDataURL(file);
      }
    },
    [onSubmit]
  );

  const loadSample = useCallback(() => {
    setText(SAMPLE_DECK);
  }, []);

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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`4 Lightning Bolt\n4 Monastery Swiftspear\n2 Eidolon of the Great Revel\n...`}
          className="w-full h-48 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 font-mono resize-none focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/25"
        />
      </div>

      {/* Image drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          dragOver
            ? "border-amber-500 bg-amber-500/5"
            : "border-gray-700 hover:border-gray-600"
        }`}
      >
        <p className="text-sm text-gray-400">
          Drop a decklist screenshot here, or{" "}
          <label className="text-amber-500 hover:text-amber-400 cursor-pointer">
            browse
            <input
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>
        </p>
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
