import { useState, useCallback, useMemo, useRef } from "react";

// ─── Constants ───
const COLOR_MAP = {
  W: { name: "White", hex: "#F9FAF4" },
  U: { name: "Blue", hex: "#0E68AB" },
  B: { name: "Black", hex: "#150B00" },
  R: { name: "Red", hex: "#D3202A" },
  G: { name: "Green", hex: "#00733E" },
};

const CATEGORIES = ["Creature","Planeswalker","Instant","Sorcery","Enchantment","Artifact","Land","Other"];

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

// ─── Parser ───
function parseDeckList(input) {
  const headers = {
    deck:"mainboard", mainboard:"mainboard", maindeck:"mainboard", main:"mainboard",
    sideboard:"sideboard", side:"sideboard", sb:"sideboard",
    companion:"companion", commander:"commander",
  };
  const lines = input.split(/\r?\n/);
  let section = "mainboard";
  let name = null;
  const entries = [];
  let seenCards = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (seenCards && section === "mainboard") section = "sideboard"; continue; }
    const key = line.toLowerCase().replace(/[:\s]/g, "");
    if (headers[key]) { section = headers[key]; continue; }
    let working = line, lineSection = section;
    if (/^SB:\s*/i.test(working)) { working = working.replace(/^SB:\s*/i, ""); lineSection = "sideboard"; }
    const m = working.match(/^(\d+)\s*[xX]?\s+(.+)$/);
    if (!m) { if (!seenCards && !name && !/^\d/.test(line)) name = line; continue; }
    let cardName = m[2].trim().replace(/\s*\([A-Z0-9]+\)\s+\d+[a-z]?$/, "").trim();
    entries.push({ quantity: parseInt(m[1]), name: cardName, section: lineSection });
    seenCards = true;
  }
  return { entries, name };
}

// ─── Scryfall ───
const cardCache = {};

async function fetchCards(identifiers) {
  const uncached = identifiers.filter((id) => !cardCache[id.name.toLowerCase()]);
  for (let i = 0; i < uncached.length; i += 75) {
    const batch = uncached.slice(i, i + 75);
    const resp = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: batch.map((id) => ({ name: id.name })) }),
    });
    if (!resp.ok) throw new Error("Scryfall API error: " + resp.status);
    const data = await resp.json();
    for (const card of data.data) cardCache[card.name.toLowerCase()] = card;
    if (i + 75 < uncached.length) await new Promise((r) => setTimeout(r, 100));
  }
}

function getImg(card, size = "normal") {
  if (card.image_uris) return card.image_uris[size];
  if (card.card_faces?.[0]?.image_uris) return card.card_faces[0].image_uris[size];
  return "";
}

function categorize(card) {
  const t = card.type_line.toLowerCase();
  for (const cat of CATEGORIES) if (t.includes(cat.toLowerCase())) return cat;
  return "Other";
}

function fmtMana(cost) {
  return (cost || "").replace(/\{([^}]+)\}/g, (_, s) => s);
}

// ─── CardHover ───
function CardHover({ card, children }) {
  const [pos, setPos] = useState(null);
  const img = getImg(card, "normal");
  const price = card.prices?.usd ? "$" + card.prices.usd : null;

  const onEnter = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const vw = window.innerWidth;
    const side = rect.left > vw / 2 ? "left" : "right";
    const x = side === "right" ? rect.right + 12 : rect.left - 262;
    const y = Math.max(8, Math.min(rect.top - 40, window.innerHeight - 420));
    setPos({ x, y });
  }, []);

  return (
    <div onMouseEnter={onEnter} onMouseLeave={() => setPos(null)} style={{ position: "relative" }}>
      {children}
      {pos && (
        <div style={{
          position: "fixed", left: pos.x, top: pos.y, zIndex: 100, pointerEvents: "none",
          background: "#111827", border: "1px solid #374151", borderRadius: 8,
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.7)", overflow: "hidden", width: 250,
        }}>
          {img && <img src={img} alt={card.name} style={{ width: 250, display: "block", borderRadius: "8px 8px 0 0" }} />}
          <div style={{ padding: 8, fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#fff", fontWeight: 500 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.name}</span>
              {price && <span style={{ color: "#34d399", flexShrink: 0, marginLeft: 8 }}>{price}</span>}
            </div>
            <div style={{ color: "#9ca3af", marginTop: 2 }}>{card.type_line}</div>
            {card.oracle_text && (
              <div style={{
                color: "#9ca3af", fontSize: 11, lineHeight: 1.3, marginTop: 4,
                display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden",
              }}>{card.oracle_text}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CardRow ───
function CardRow({ card, quantity }) {
  const thumb = getImg(card, "small");
  const mana = fmtMana(card.mana_cost || card.card_faces?.[0]?.mana_cost || "");

  return (
    <CardHover card={card}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "3px 8px",
        borderRadius: 4, cursor: "default", transition: "background 0.15s",
      }}
        onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
      >
        <span style={{ fontSize: 14, color: "#6b7280", width: 20, textAlign: "right", fontFamily: "monospace" }}>{quantity}</span>
        <div style={{ width: 32, height: 24, borderRadius: 3, overflow: "hidden", background: "#1f2937", flexShrink: 0 }}>
          {thumb && <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 25%" }} loading="lazy" />}
        </div>
        <span style={{ fontSize: 14, color: "#d1d5db", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.name}</span>
        <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "monospace", flexShrink: 0 }}>{mana}</span>
      </div>
    </CardHover>
  );
}

// ─── ManaCurve ───
function ManaCurve({ cards }) {
  const nonLands = cards.filter((c) => !c.card.type_line.toLowerCase().includes("land"));
  const buckets = {};
  for (const { card, quantity } of nonLands) {
    const mv = Math.min(Math.floor(card.cmc), 7);
    buckets[mv] = (buckets[mv] || 0) + quantity;
  }
  const max = Math.max(...Object.values(buckets), 1);

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 64 }}>
      {[0,1,2,3,4,5,6,7].map((mv) => {
        const count = buckets[mv] || 0;
        const h = count > 0 ? Math.max(4, (count / max) * 52) : 0;
        return (
          <div key={mv} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            {count > 0 && <span style={{ fontSize: 10, color: "#9ca3af" }}>{count}</span>}
            <div style={{ width: "100%", height: h, background: "rgba(217,119,6,0.7)", borderRadius: 2, transition: "height 0.3s" }} />
            <span style={{ fontSize: 10, color: "#6b7280" }}>{mv === 7 ? "7+" : mv}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── DeckSection ───
function DeckSection({ entries, label, deckName }) {
  const grouped = useMemo(() => {
    const groups = {};
    for (const cat of CATEGORIES) groups[cat] = [];
    const sorted = [...entries].sort((a, b) => {
      const ci = CATEGORIES.indexOf(categorize(a.card)) - CATEGORIES.indexOf(categorize(b.card));
      return ci !== 0 ? ci : a.card.cmc - b.card.cmc;
    });
    for (const e of sorted) groups[categorize(e.card)].push(e);
    return groups;
  }, [entries]);

  const total = entries.reduce((s, e) => s + e.quantity, 0);
  const colors = useMemo(() => {
    const c = new Set();
    for (const { card } of entries) for (const ci of card.color_identity) c.add(ci);
    return Array.from(c);
  }, [entries]);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        {deckName && label === "Mainboard" && <div style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>{deckName}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#9ca3af", marginTop: 4 }}>
          <span>{label}</span><span>·</span><span>{total} cards</span>
          {colors.length > 0 && (
            <>
              <span>·</span>
              <div style={{ display: "flex", gap: 3 }}>
                {colors.map((c) => (
                  <span key={c} title={COLOR_MAP[c]?.name || c} style={{
                    width: 16, height: 16, borderRadius: "50%", border: "1px solid #4b5563",
                    background: COLOR_MAP[c]?.hex || "#888", display: "inline-block",
                  }} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {CATEGORIES.map((cat) => {
        const items = grouped[cat];
        if (items.length === 0) return null;
        const count = items.reduce((s, e) => s + e.quantity, 0);
        return (
          <div key={cat} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              {cat} ({count})
            </div>
            {items.map((e) => <CardRow key={e.card.id} card={e.card} quantity={e.quantity} />)}
          </div>
        );
      })}

      <div style={{ borderTop: "1px solid #1f2937", paddingTop: 12, marginTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Mana Curve</div>
        <ManaCurve cards={entries.map((e) => ({ card: e.card, quantity: e.quantity }))} />
      </div>
    </div>
  );
}

// ─── Main App ───
export default function App() {
  const [view, setView] = useState("input"); // "input" | "loading" | "results"
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const [mainboard, setMainboard] = useState([]);
  const [sideboard, setSideboard] = useState([]);
  const [deckName, setDeckName] = useState(null);

  const handleSubmit = useCallback(async () => {
    if (!text.trim()) return;
    setView("loading");
    setError(null);

    try {
      const deck = parseDeckList(text);
      if (deck.entries.length === 0) { setError("No cards found. Check your decklist format."); setView("input"); return; }

      const unique = [];
      const seen = new Set();
      for (const e of deck.entries) {
        const k = e.name.toLowerCase();
        if (!seen.has(k)) { seen.add(k); unique.push({ name: e.name }); }
      }
      await fetchCards(unique);

      const resolve = (section) => deck.entries
        .filter((e) => e.section === section)
        .map((e) => ({ ...e, card: cardCache[e.name.toLowerCase()] }))
        .filter((e) => e.card);

      const main = resolve("mainboard");
      const side = resolve("sideboard");

      if (main.length === 0 && side.length === 0) {
        setError("Could not find any cards on Scryfall. Check spelling.");
        setView("input");
        return;
      }

      setMainboard(main);
      setSideboard(side);
      setDeckName(deck.name);
      setView("results");
    } catch (err) {
      setError(err.message || "Something went wrong.");
      setView("input");
    }
  }, [text]);

  const reset = useCallback(() => {
    setView("input");
    setMainboard([]);
    setSideboard([]);
    setDeckName(null);
  }, []);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 16px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", background: "#0a0a0a", color: "#e5e5e5", minHeight: "100vh" }}>

      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#fff", margin: "0 0 4px" }}>MTG Deck Viewer</h1>
        <p style={{ fontSize: 14, color: "#6b7280", margin: 0 }}>Paste a decklist. Hover to inspect cards. Share anywhere.</p>
      </div>

      {/* Input */}
      {view === "input" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <label style={{ fontSize: 14, fontWeight: 500, color: "#d1d5db" }}>Paste a decklist</label>
            <button onClick={() => setText(SAMPLE_DECK)} style={{ fontSize: 12, color: "#d97706", background: "none", border: "none", cursor: "pointer" }}>Load sample deck</button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
            placeholder={"4 Lightning Bolt\n4 Monastery Swiftspear\n2 Eidolon of the Great Revel\n..."}
            style={{
              width: "100%", height: 200, background: "#111", border: "1px solid #333", borderRadius: 8,
              padding: 12, fontSize: 14, color: "#e5e5e5", fontFamily: "'SF Mono', 'Fira Code', monospace",
              resize: "vertical", outline: "none", boxSizing: "border-box",
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!text.trim()}
            style={{
              width: "100%", marginTop: 16, padding: "10px 0",
              background: text.trim() ? "#b45309" : "#374151",
              color: text.trim() ? "#fff" : "#6b7280",
              fontSize: 14, fontWeight: 500, border: "none", borderRadius: 8, cursor: text.trim() ? "pointer" : "not-allowed",
            }}
          >
            View Deck
          </button>
          {error && (
            <div style={{ marginTop: 16, padding: 12, background: "rgba(127,29,29,0.2)", border: "1px solid rgba(127,29,29,0.4)", borderRadius: 8, fontSize: 14, color: "#fca5a5" }}>
              {error}
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {view === "loading" && (
        <div style={{ textAlign: "center", padding: 48, color: "#6b7280" }}>
          <div style={{
            width: 24, height: 24, border: "2px solid #333", borderTopColor: "#d97706",
            borderRadius: "50%", animation: "spin 0.6s linear infinite", margin: "0 auto 12px",
          }} />
          <div>Loading cards from Scryfall...</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Results */}
      {view === "results" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <button onClick={reset} style={{ fontSize: 14, color: "#9ca3af", background: "none", border: "none", cursor: "pointer" }}>← New deck</button>
          </div>
          <DeckSection entries={mainboard} label="Mainboard" deckName={deckName} />
          {sideboard.length > 0 && (
            <div style={{ borderTop: "1px solid #1f2937", paddingTop: 16, marginTop: 24 }}>
              <DeckSection entries={sideboard} label="Sideboard" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
