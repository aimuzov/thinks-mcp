import { describe, expect, it } from 'vitest'
import { stemEnglish, stemRussian, stemsOf, tokenize } from './stem.js'

/** Words that must collapse to one stem, or the archive search misses matches. */
const FAMILIES: string[][] = [
  ['сообщение', 'сообщения', 'сообщений', 'сообщениями'],
  ['работа', 'работы', 'работе', 'работу', 'работой'],
  ['красный', 'красная', 'красное', 'красные', 'красного'],
  ['делать', 'делал', 'делала', 'делали', 'делаю'],
  ['машина', 'машины', 'машине', 'машину'],
  ['встреча', 'встречи', 'встрече', 'встречу'],
]

describe('stemRussian', () => {
  for (const family of FAMILIES) {
    it(`collapses ${family[0]} and its forms`, () => {
      const stems = new Set(family.map(stemRussian))
      expect([...stems]).toHaveLength(1)
    })
  }

  it('leaves short words alone', () => {
    expect(stemRussian('не')).toBe('не')
    expect(stemRussian('в')).toBe('в')
  })

  it('does not collapse unrelated words', () => {
    expect(stemRussian('машина')).not.toBe(stemRussian('встреча'))
    expect(stemRussian('дом')).not.toBe(stemRussian('день'))
  })
})

/** English families that must collapse — 23% of the code corpus is English. */
const ENGLISH_FAMILIES: string[][] = [
  ['comment', 'comments', 'commenting', 'commented'],
  ['retry', 'retries', 'retrying'],
  ['cache', 'caches', 'caching', 'cached'],
  ['render', 'renders', 'rendering', 'rendered'],
]

describe('stemEnglish', () => {
  for (const family of ENGLISH_FAMILIES) {
    it(`collapses ${family[0]} and its forms`, () => {
      expect([...new Set(family.map(stemEnglish))]).toHaveLength(1)
    })
  }

  it('leaves short words alone', () => {
    expect(stemEnglish('the')).toBe('the')
    expect(stemEnglish('id')).toBe('id')
  })

  it('does not collapse unrelated words', () => {
    expect(stemEnglish('cache')).not.toBe(stemEnglish('catch'))
  })
})

describe('tokenize', () => {
  it('lowercases, folds ё and drops punctuation', () => {
    expect(tokenize('Ещё раз, Привет!')).toEqual(tokenize('еще раз привет'))
  })

  it('stems latin words too', () => {
    expect(tokenize('caching retries')).toEqual(tokenize('cached retry'))
  })

  it('drops single characters', () => {
    expect(tokenize('я в а')).toEqual([])
  })

  it('renders a space-joined string for the FTS column', () => {
    expect(stemsOf('Работы много')).toBe(
      `${stemRussian('работы')} ${stemRussian('много')}`
    )
  })
})
