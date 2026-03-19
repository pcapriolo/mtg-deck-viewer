import { describe, it, expect } from 'vitest'
import {
  cardImageUri,
  categorizeCard,
  categoryOrder,
  COLOR_MAP,
  type ScryfallCard,
  type CardCategory,
} from '../scryfall'

function makeMockCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'test-id',
    name: 'Test Card',
    mana_cost: '{1}{R}',
    cmc: 2,
    type_line: 'Instant',
    color_identity: ['R'],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test Set',
    collector_number: '1',
    image_uris: {
      small: 'https://example.com/small.jpg',
      normal: 'https://example.com/normal.jpg',
      large: 'https://example.com/large.jpg',
      png: 'https://example.com/png.png',
      art_crop: 'https://example.com/art_crop.jpg',
      border_crop: 'https://example.com/border_crop.jpg',
    },
    prices: {},
    legalities: {},
    keywords: [],
    ...overrides,
  }
}

describe('cardImageUri', () => {
  it('returns the correct URI for a normal card', () => {
    const card = makeMockCard()
    expect(cardImageUri(card)).toBe('https://example.com/normal.jpg')
    expect(cardImageUri(card, 'small')).toBe('https://example.com/small.jpg')
    expect(cardImageUri(card, 'large')).toBe('https://example.com/large.jpg')
  })

  it('returns the front face URI for a double-faced card', () => {
    const card = makeMockCard({
      image_uris: undefined,
      card_faces: [
        {
          name: 'Front Face',
          mana_cost: '{1}{R}',
          type_line: 'Creature',
          image_uris: {
            small: 'https://example.com/front-small.jpg',
            normal: 'https://example.com/front-normal.jpg',
            large: 'https://example.com/front-large.jpg',
            png: 'https://example.com/front-png.png',
            art_crop: 'https://example.com/front-art.jpg',
            border_crop: 'https://example.com/front-border.jpg',
          },
        },
        {
          name: 'Back Face',
          mana_cost: '',
          type_line: 'Creature',
          image_uris: {
            small: 'https://example.com/back-small.jpg',
            normal: 'https://example.com/back-normal.jpg',
            large: 'https://example.com/back-large.jpg',
            png: 'https://example.com/back-png.png',
            art_crop: 'https://example.com/back-art.jpg',
            border_crop: 'https://example.com/back-border.jpg',
          },
        },
      ],
    })

    expect(cardImageUri(card)).toBe('https://example.com/front-normal.jpg')
    expect(cardImageUri(card, 'small')).toBe('https://example.com/front-small.jpg')
  })

  it('returns empty string for a card with no images', () => {
    const card = makeMockCard({
      image_uris: undefined,
      card_faces: undefined,
    })
    expect(cardImageUri(card)).toBe('')
  })
})

describe('categorizeCard', () => {
  const cases: Array<[string, CardCategory]> = [
    ['Creature — Human Wizard', 'Creature'],
    ['Legendary Planeswalker — Jace', 'Planeswalker'],
    ['Instant', 'Instant'],
    ['Sorcery', 'Sorcery'],
    ['Enchantment — Aura', 'Enchantment'],
    ['Artifact — Equipment', 'Artifact'],
    ['Basic Land — Mountain', 'Land'],
    ['Tribal Enchantment — Goblin', 'Enchantment'],
    ['Artifact Creature — Golem', 'Creature'],
    ['Enchantment Creature — God', 'Creature'],
  ]

  it.each(cases)('categorizes "%s" as %s', (typeLine, expected) => {
    const card = makeMockCard({ type_line: typeLine })
    expect(categorizeCard(card)).toBe(expected)
  })

  it('returns "Other" for an unrecognized type line', () => {
    const card = makeMockCard({ type_line: 'Conspiracy' })
    expect(categorizeCard(card)).toBe('Other')
  })
})

describe('categoryOrder', () => {
  it('returns correct indices for all categories', () => {
    expect(categoryOrder('Creature')).toBe(0)
    expect(categoryOrder('Planeswalker')).toBe(1)
    expect(categoryOrder('Instant')).toBe(2)
    expect(categoryOrder('Sorcery')).toBe(3)
    expect(categoryOrder('Enchantment')).toBe(4)
    expect(categoryOrder('Artifact')).toBe(5)
    expect(categoryOrder('Land')).toBe(6)
    expect(categoryOrder('Other')).toBe(7)
  })
})

describe('COLOR_MAP', () => {
  it('contains all 5 MTG colors', () => {
    expect(COLOR_MAP).toHaveProperty('W')
    expect(COLOR_MAP).toHaveProperty('U')
    expect(COLOR_MAP).toHaveProperty('B')
    expect(COLOR_MAP).toHaveProperty('R')
    expect(COLOR_MAP).toHaveProperty('G')
  })

  it('each color has name and hex properties', () => {
    for (const color of ['W', 'U', 'B', 'R', 'G']) {
      expect(COLOR_MAP[color]).toHaveProperty('name')
      expect(COLOR_MAP[color]).toHaveProperty('hex')
      expect(typeof COLOR_MAP[color].name).toBe('string')
      expect(COLOR_MAP[color].hex).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})
