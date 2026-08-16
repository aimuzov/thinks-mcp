import { describe, expect, it } from 'vitest'
import { countWords, markers, type Counts } from './lexicon.js'

function counts(pairs: [string, number][]): Counts {
  return new Map(pairs)
}

describe('countWords', () => {
  it('lowercases, folds ё and skips single letters', () => {
    const c: Counts = new Map()
    countWords('Ещё раз ещё, я в Ага!', c)
    expect(c.get('еще')).toBe(2)
    expect(c.get('ага')).toBe(1)
    expect(c.has('я')).toBe(false)
  })
})

describe('markers', () => {
  it('ranks a distinctive word above an equally common one', () => {
    const mine = counts([
      ['не', 5000],
      ['ага', 400],
      ['норм', 300],
    ])
    const theirs = counts([
      ['не', 5000],
      ['ага', 10],
      ['норм', 5],
    ])

    const ranked = markers(mine, theirs, { minTotal: 10 })
    const words = ranked.map(m => m.word)

    expect(words.indexOf('ага')).toBeLessThan(words.indexOf('не'))
    expect(words.indexOf('норм')).toBeLessThan(words.indexOf('не'))
  })

  it('ignores words below the frequency floor', () => {
    const ranked = markers(
      counts([
        ['редкое', 3],
        ['частое', 500],
      ]),
      counts([['частое', 100]]),
      { minTotal: 40 }
    )
    expect(ranked.map(m => m.word)).not.toContain('редкое')
  })

  it('returns nothing when either corpus is empty', () => {
    expect(markers(counts([['а', 10]]), counts([]))).toEqual([])
  })
})
