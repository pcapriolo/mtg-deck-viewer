import { describe, it, expect } from 'vitest'
import {
  parseDeckList,
  mainboardEntries,
  sideboardEntries,
  companionEntries,
  totalCards,
  type DeckEntry,
  type ParsedDeck,
} from '../parser'

describe('parseDeckList', () => {
  describe('basic card parsing', () => {
    it('parses "4 Lightning Bolt" as qty=4, name="Lightning Bolt", section=mainboard', () => {
      const result = parseDeckList('4 Lightning Bolt')
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0]).toEqual({
        quantity: 4,
        name: 'Lightning Bolt',
        set: undefined,
        collectorNumber: undefined,
        section: 'mainboard',
      })
    })

    it('parses "4x Lightning Bolt" (lowercase x)', () => {
      const result = parseDeckList('4x Lightning Bolt')
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].quantity).toBe(4)
      expect(result.entries[0].name).toBe('Lightning Bolt')
    })

    it('parses "4X Lightning Bolt" (uppercase X)', () => {
      const result = parseDeckList('4X Lightning Bolt')
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].quantity).toBe(4)
      expect(result.entries[0].name).toBe('Lightning Bolt')
    })
  })

  describe('Arena format', () => {
    it('parses "4 Lightning Bolt (MH3) 123" with set and collector number', () => {
      const result = parseDeckList('4 Lightning Bolt (MH3) 123')
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0]).toEqual({
        quantity: 4,
        name: 'Lightning Bolt',
        set: 'MH3',
        collectorNumber: '123',
        section: 'mainboard',
      })
    })

    it('handles collector numbers with letter suffixes like "123a"', () => {
      const result = parseDeckList('1 Card Name (SET) 42a')
      expect(result.entries[0].collectorNumber).toBe('42a')
    })
  })

  describe('MTGO sideboard prefix', () => {
    it('parses "SB: 2 Mystical Dispute" as sideboard', () => {
      const result = parseDeckList('SB: 2 Mystical Dispute')
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0]).toEqual({
        quantity: 2,
        name: 'Mystical Dispute',
        set: undefined,
        collectorNumber: undefined,
        section: 'sideboard',
      })
    })

    it('handles lowercase "sb:" prefix', () => {
      const result = parseDeckList('sb: 1 Negate')
      expect(result.entries[0].section).toBe('sideboard')
      expect(result.entries[0].name).toBe('Negate')
    })
  })

  describe('section headers', () => {
    it('recognizes "Sideboard" header', () => {
      const input = '4 Lightning Bolt\nSideboard\n2 Negate'
      const result = parseDeckList(input)
      expect(result.entries[0].section).toBe('mainboard')
      expect(result.entries[1].section).toBe('sideboard')
    })

    it('recognizes "Side:" header', () => {
      const input = '4 Lightning Bolt\nSide:\n2 Negate'
      const result = parseDeckList(input)
      expect(result.entries[1].section).toBe('sideboard')
    })

    it('recognizes "Companion" header', () => {
      const input = 'Companion\n1 Lurrus of the Dream-Den'
      const result = parseDeckList(input)
      expect(result.entries[0].section).toBe('companion')
    })

    it('recognizes "Commander" header', () => {
      const input = 'Commander\n1 Atraxa, Praetors\' Voice'
      const result = parseDeckList(input)
      expect(result.entries[0].section).toBe('commander')
    })
  })

  describe('blank line section switching', () => {
    it('switches to sideboard after blank line following mainboard cards', () => {
      const input = '4 Lightning Bolt\n\n2 Negate'
      const result = parseDeckList(input)
      expect(result.entries[0].section).toBe('mainboard')
      expect(result.entries[1].section).toBe('sideboard')
    })

    it('does not switch section on blank line before any cards', () => {
      const input = '\n\n4 Lightning Bolt'
      const result = parseDeckList(input)
      expect(result.entries[0].section).toBe('mainboard')
    })
  })

  describe('deck name detection', () => {
    it('detects deck name from non-card text before first card', () => {
      const input = 'Burn Deck\n4 Lightning Bolt\n4 Lava Spike'
      const result = parseDeckList(input)
      expect(result.name).toBe('Burn Deck')
      expect(result.entries).toHaveLength(2)
    })

    it('does not detect deck name if first line starts with a digit', () => {
      const input = '4 Lightning Bolt'
      const result = parseDeckList(input)
      expect(result.name).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('returns empty entries and no name for empty input', () => {
      const result = parseDeckList('')
      expect(result.entries).toEqual([])
      expect(result.name).toBeUndefined()
    })

    it('returns empty entries for garbage text', () => {
      const result = parseDeckList('asdf jkl; qwerty\nmore garbage\n!!!')
      // First non-numeric line may be treated as deck name, but no entries
      expect(result.entries).toEqual([])
    })

    it('handles Windows line endings (\\r\\n)', () => {
      const input = '4 Lightning Bolt\r\n2 Lava Spike\r\n\r\n1 Negate'
      const result = parseDeckList(input)
      expect(result.entries).toHaveLength(3)
      expect(result.entries[0].name).toBe('Lightning Bolt')
      expect(result.entries[2].section).toBe('sideboard')
    })

    it('handles leading and trailing whitespace on lines', () => {
      const input = '  4 Lightning Bolt  \n  2 Lava Spike  '
      const result = parseDeckList(input)
      expect(result.entries).toHaveLength(2)
      expect(result.entries[0].name).toBe('Lightning Bolt')
      expect(result.entries[1].name).toBe('Lava Spike')
    })
  })
})

describe('helper functions', () => {
  const deck: ParsedDeck = {
    entries: [
      { quantity: 4, name: 'Lightning Bolt', section: 'mainboard' },
      { quantity: 4, name: 'Lava Spike', section: 'mainboard' },
      { quantity: 2, name: 'Negate', section: 'sideboard' },
      { quantity: 1, name: 'Flusterstorm', section: 'sideboard' },
    ],
    name: 'Test Deck',
  }

  describe('mainboardEntries', () => {
    it('returns only mainboard entries', () => {
      const main = mainboardEntries(deck)
      expect(main).toHaveLength(2)
      expect(main.every((e) => e.section === 'mainboard')).toBe(true)
    })
  })

  describe('sideboardEntries', () => {
    it('returns only sideboard entries', () => {
      const side = sideboardEntries(deck)
      expect(side).toHaveLength(2)
      expect(side.every((e) => e.section === 'sideboard')).toBe(true)
    })
  })

  describe('companionEntries', () => {
    it('returns only companion entries', () => {
      const deckWithCompanion: ParsedDeck = {
        entries: [
          { quantity: 4, name: 'Lightning Bolt', section: 'mainboard' },
          { quantity: 1, name: 'Lurrus of the Dream-Den', section: 'companion' },
          { quantity: 2, name: 'Negate', section: 'sideboard' },
        ],
      }
      const comp = companionEntries(deckWithCompanion)
      expect(comp).toHaveLength(1)
      expect(comp[0].name).toBe('Lurrus of the Dream-Den')
      expect(comp[0].section).toBe('companion')
    })

    it('returns empty array when no companion entries exist', () => {
      expect(companionEntries(deck)).toHaveLength(0)
    })

    it('companion entry is not included in mainboard or sideboard', () => {
      const deckWithCompanion: ParsedDeck = {
        entries: [
          { quantity: 4, name: 'Lightning Bolt', section: 'mainboard' },
          { quantity: 1, name: 'Yorion, Sky Nomad', section: 'companion' },
        ],
      }
      expect(mainboardEntries(deckWithCompanion)).toHaveLength(1)
      expect(sideboardEntries(deckWithCompanion)).toHaveLength(0)
      expect(companionEntries(deckWithCompanion)).toHaveLength(1)
    })
  })

  describe('totalCards', () => {
    it('sums all quantities', () => {
      expect(totalCards(deck.entries)).toBe(11)
    })

    it('returns 0 for empty array', () => {
      expect(totalCards([])).toBe(0)
    })
  })
})
