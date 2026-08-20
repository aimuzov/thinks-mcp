import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, rebuildIndexes, resetRegisters, type Db } from '../store/db.js'
import { insertTurns, pickHoldout } from './indexer.js'
import { buildMatch, holdoutTurns, searchTurns } from './query.js'
import { stemsOf } from './stem.js'
import type { Turn } from '../corpus/types.js'

function turn(partial: Partial<Turn> & { text: string }): Turn {
  const parts = partial.parts ?? [partial.text]
  const text = parts.join('\n')
  return {
    chatKey: 'chat-aaa',
    register: 'dm',
    longform: text.length >= 300,
    ts: 1_700_000_000,
    year: 2023,
    parts,
    text,
    chars: text.length,
    contextIn: null,
    ...partial,
    // keep text and parts consistent even when the caller overrode one
    ...(partial.parts ? { text } : {}),
  }
}

const CORPUS: Turn[] = [
  turn({ text: 'Поеду на встречу в понедельник.' }),
  turn({ text: 'Встречи все перенесли.' }),
  turn({ text: 'Машину забрал из сервиса.' }),
  turn({ text: 'Ок.' }),
  turn({ text: 'ок' }),
  turn({ text: 'Не я.', register: 'group' }),
  turn({
    text: 'Сантехника вызывает управляющая компания по заявке.',
    register: 'group',
  }),
  turn({
    text: 'Ответ на вопрос про сроки.',
    contextIn: 'Когда будет готова машина?',
  }),
]

let db: Db

function seed(target: Db, turns: Turn[], holdout: Set<number>) {
  insertTurns(target, turns, holdout)
  rebuildIndexes(target, stemsOf)
}

beforeEach(() => {
  db = openDb(':memory:')
  seed(db, CORPUS, new Set())
})

describe('buildMatch', () => {
  it('drops function words', () => {
    expect(buildMatch('не в на что это')).toBeNull()
  })

  it('quotes each token and joins with OR', () => {
    const match = buildMatch('машину забрал')
    expect(match).toMatch(/^"[^"]+" OR "[^"]+"$/)
  })
})

describe('searchTurns', () => {
  it('matches across inflections', () => {
    const [top] = searchTurns(db, 'встреча', { limit: 3 })
    expect(top.text).toMatch(/[Вв]стреч/)
  })

  it('honours the register facet', () => {
    const rows = searchTurns(db, 'сантехник компания', {
      register: 'group',
      limit: 5,
    })
    expect(rows.every(r => r.register === 'group')).toBe(true)
  })

  it('collapses near-duplicates that differ only in case and punctuation', () => {
    const rows = searchTurns(db, 'ок', { limit: 10 })
    expect(rows.filter(r => /^ок\.?$/i.test(r.text))).toHaveLength(1)
  })

  it('never returns an empty brief, even for an unmatchable query', () => {
    const rows = searchTurns(db, 'квантовая хромодинамика', { limit: 4 })
    expect(rows.length).toBeGreaterThan(0)
  })

  it('searches incoming messages when asked for reply context', () => {
    const rows = searchTurns(db, 'машина готова', {
      matchContext: true,
      requireContext: true,
      limit: 3,
    })
    expect(rows[0]?.contextIn).toBe('Когда будет готова машина?')
  })
})

describe('pair confidence', () => {
  const quoted = turn({
    text: 'Отвечаю на вопрос про доставку.',
    contextIn: 'Что там с доставкой заказа?',
    contextExplicit: true,
  })
  const inferred = turn({
    text: 'Случайная реплика не по теме.',
    contextIn: 'Что там с доставкой заказа?',
    contextExplicit: false,
  })

  it('ranks a quoted pair above an inferred one', () => {
    const fresh = openDb(':memory:')
    // Inferred first, so order alone cannot explain the result.
    seed(fresh, [inferred, quoted], new Set())

    const [top] = searchTurns(fresh, 'что с доставкой заказа', {
      matchContext: true,
      requireContext: true,
      limit: 2,
    })
    expect(top.contextExplicit).toBe(true)
  })

  it('leaves ranking alone when searching the owner own turns', () => {
    const fresh = openDb(':memory:')
    seed(fresh, [inferred, quoted], new Set())

    // Matching against what the owner said: there is no pair to judge, so the
    // penalty must not apply and relevance decides.
    const [top] = searchTurns(fresh, 'случайная реплика', { limit: 2 })
    expect(top.text).toBe('Случайная реплика не по теме.')
  })
})

describe('two corpora in one database', () => {
  const codeTurn = turn({
    text: 'Почему выбран этот таймаут.',
    register: 'code' as never,
    chatKey: 'my-repo',
    lang: 'ru',
    contextIn: 'const TIMEOUT = 300',
  })

  it('keeps code turns when the chat corpus is rebuilt', () => {
    insertTurns(db, [codeTurn], new Set())
    rebuildIndexes(db, stemsOf)

    // What `thinks-mcp build` does: wipe only the chat registers.
    resetRegisters(db, ['dm', 'group'])
    seed(db, CORPUS, new Set())

    const found = searchTurns(db, 'таймаут', {
      register: 'code' as never,
      limit: 5,
    })
    expect(found[0]?.text).toBe('Почему выбран этот таймаут.')
    expect(found[0]?.chatKey).toBe('my-repo')
  })

  it('does not mix code into a chat search', () => {
    insertTurns(db, [codeTurn], new Set())
    rebuildIndexes(db, stemsOf)

    const found = searchTurns(db, 'таймаут', { register: 'dm', limit: 5 })
    expect(found.every(r => r.register === 'dm')).toBe(true)
  })

  it('filters code examples by language', () => {
    const english = turn({
      text: 'Why this timeout was chosen.',
      register: 'code' as never,
      chatKey: 'my-repo',
      lang: 'en',
    })
    insertTurns(db, [codeTurn, english], new Set())
    rebuildIndexes(db, stemsOf)

    const ru = searchTurns(db, 'таймаут timeout', {
      register: 'code' as never,
      lang: 'ru',
      limit: 5,
    })
    expect(ru.every(r => r.lang === 'ru')).toBe(true)
  })
})

describe('holdout', () => {
  it('stores held-out turns but keeps them out of the index', () => {
    const fresh = openDb(':memory:')
    const ids = pickHoldout(CORPUS, 1)
    seed(fresh, CORPUS, ids)

    expect(holdoutTurns(fresh)).toHaveLength(1)

    const found = searchTurns(fresh, 'ответ вопрос сроки', {
      limit: 10,
    })
    expect(found.some(r => r.text === 'Ответ на вопрос про сроки.')).toBe(false)
  })
})
