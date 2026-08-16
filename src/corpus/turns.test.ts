import { describe, expect, it } from 'vitest'
import { iterateChats, resolveOwnerId } from './parse.js'
import { collectSurnames, createSanitizer } from './sanitize.js'
import { emptyStats } from './filter.js'
import { buildTurns } from './turns.js'
import type { Turn } from './types.js'
import { makeDump, OWNER_ID } from '../testing/fixtures.js'

function build() {
  const dump = makeDump()
  const stats = emptyStats()
  const san = createSanitizer(collectSurnames(['Ivan Petrov', 'Sergey Volkov']))
  const turns: Turn[] = []
  for (const chat of iterateChats(dump)) {
    turns.push(
      ...buildTurns(
        chat,
        san,
        { ownerId: OWNER_ID, burstWindowSeconds: 90, longformMinChars: 300 },
        stats
      )
    )
  }
  return { turns, stats }
}

describe('resolveOwnerId', () => {
  it('reads the owner off Saved Messages', () => {
    expect(resolveOwnerId(makeDump())).toBe(OWNER_ID)
  })
})

describe('buildTurns', () => {
  it('merges a burst into one turn and keeps the parts separate', () => {
    const { turns } = build()
    const burst = turns.find(t => t.parts[0] === 'Через час.')
    expect(burst?.parts).toEqual([
      'Через час.',
      'Может раньше.',
      'Напишу как выйду.',
    ])
    expect(burst?.text).toBe('Через час.\nМожет раньше.\nНапишу как выйду.')
  })

  it('attaches the incoming message as reply context', () => {
    const { turns } = build()
    const burst = turns.find(t => t.parts[0] === 'Через час.')
    expect(burst?.contextIn).toBe('Ты когда освободишься?')
  })

  it('does not reuse one incoming message for two turns', () => {
    const { turns } = build()
    const later = turns.find(t => t.parts[0] === 'Вышел.')
    expect(later?.contextIn).toBeNull()
  })

  it('drops forwards, bot messages, pasted JSON and bare links', () => {
    const { turns, stats } = build()
    const texts = turns.flatMap(t => t.parts)
    expect(texts).not.toContain('Длинный чужой текст про новости.')
    expect(texts).not.toContain('сгенерировано ботом')
    expect(texts.some(t => t.includes('update_id'))).toBe(false)
    expect(texts.some(t => t === '<ссылка>')).toBe(false)
    expect(stats.forwarded).toBe(1)
    expect(stats['via-bot']).toBe(1)
    expect(stats.structured).toBe(1)
  })

  it('assigns registers from the chat type', () => {
    const { turns } = build()
    expect(turns.find(t => t.parts[0] === 'Через час.')?.register).toBe('dm')
    expect(turns.find(t => t.parts[0] === 'Не я.')?.register).toBe('group')
  })

  it('flags a long turn as longform without losing its register', () => {
    const { turns } = build()
    const long = turns.find(t => t.chars >= 300)
    expect(long?.longform).toBe(true)
    expect(long?.register).toBe('group')
    expect(turns.find(t => t.parts[0] === 'Не я.')?.longform).toBe(false)
  })
})

describe('sanitize', () => {
  it('replaces tagged phone and email with placeholders', () => {
    const { turns } = build()
    const pii = turns.find(t => t.text.includes('<почта>'))
    expect(pii?.text).toContain('<телефон>')
    expect(pii?.text).not.toContain('example.com')
    expect(pii?.text).not.toContain('999')
  })

  it('scrubs surnames but keeps the sentence readable', () => {
    const { turns } = build()
    const pii = turns.find(t => t.text.includes('<почта>'))
    expect(pii?.text).not.toContain('Volkov')
    expect(pii?.text).toContain('в курсе')
  })

  it('keeps the visible text of a link, drops the href', () => {
    const { turns } = build()
    const linked = turns.find(t => t.text.includes('вот сюда'))
    expect(linked?.text).toBe('Смотри вот сюда')
  })
})
