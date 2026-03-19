import { describe, it, expect } from 'vitest'
import { encodeDeck, decodeDeck } from '../deck-encoder'
import type { ParsedDeck } from '../parser'

describe('deck-encoder round-trip', () => {
  it('round-trips a simple deck preserving all entries', () => {
    const deck: ParsedDeck = {
      entries: [
        { quantity: 4, name: 'Lightning Bolt', section: 'mainboard' },
        { quantity: 4, name: 'Lava Spike', section: 'mainboard' },
        { quantity: 2, name: 'Monastery Swiftspear', section: 'mainboard' },
      ],
    }

    const encoded = encodeDeck(deck)
    const decoded = decodeDeck(encoded)

    expect(decoded.entries).toHaveLength(3)
    for (let i = 0; i < deck.entries.length; i++) {
      expect(decoded.entries[i].quantity).toBe(deck.entries[i].quantity)
      expect(decoded.entries[i].name).toBe(deck.entries[i].name)
      expect(decoded.entries[i].section).toBe(deck.entries[i].section)
    }
  })

  it('round-trips preserving deck name', () => {
    const deck: ParsedDeck = {
      entries: [
        { quantity: 4, name: 'Lightning Bolt', section: 'mainboard' },
      ],
      name: 'Burn Deck',
    }

    const encoded = encodeDeck(deck)
    const decoded = decodeDeck(encoded)

    // The encoder stores the name; verify it survives the round-trip
    expect(decoded.name).toBeDefined()
    expect(decoded.name).toContain('Burn Deck')
  })

  it('round-trips preserving sideboard entries', () => {
    const deck: ParsedDeck = {
      entries: [
        { quantity: 4, name: 'Lightning Bolt', section: 'mainboard' },
        { quantity: 2, name: 'Negate', section: 'sideboard' },
        { quantity: 1, name: 'Flusterstorm', section: 'sideboard' },
      ],
    }

    const encoded = encodeDeck(deck)
    const decoded = decodeDeck(encoded)

    // All card entries should survive the round-trip
    const allNames = decoded.entries.map((e) => e.name)
    expect(allNames).toContain('Lightning Bolt')
    expect(allNames).toContain('Negate')
    expect(allNames).toContain('Flusterstorm')

    // Verify quantities are preserved
    const bolt = decoded.entries.find((e) => e.name === 'Lightning Bolt')
    const negate = decoded.entries.find((e) => e.name === 'Negate')
    const flusterstorm = decoded.entries.find((e) => e.name === 'Flusterstorm')
    expect(bolt?.quantity).toBe(4)
    expect(negate?.quantity).toBe(2)
    expect(flusterstorm?.quantity).toBe(1)
  })
})

describe('encoded string format', () => {
  it('produces a URL-safe string (no +, /, or =)', () => {
    const deck: ParsedDeck = {
      entries: [
        { quantity: 4, name: 'Lightning Bolt', section: 'mainboard' },
        { quantity: 4, name: 'Counterspell', section: 'mainboard' },
        { quantity: 4, name: "Teferi, Time Raveler", section: 'mainboard' },
        { quantity: 2, name: 'Negate', section: 'sideboard' },
      ],
      name: 'Test Deck with Special Characters!',
    }

    const encoded = encodeDeck(deck)

    expect(encoded).not.toMatch(/\+/)
    expect(encoded).not.toMatch(/\//)
    expect(encoded).not.toMatch(/=/)
  })
})

describe('decode error handling', () => {
  it('does not crash on invalid encoded string', () => {
    // "not-valid-data" is valid base64url (maps to base64 "not+valid+data")
    expect(() => decodeDeck('not-valid-data')).not.toThrow()
  })

  it('returns a ParsedDeck for any decodable input', () => {
    // Use a string that is valid base64url but not a real deck
    const result = decodeDeck('AAAA')
    expect(result).toHaveProperty('entries')
    expect(Array.isArray(result.entries)).toBe(true)
  })
})
