import { describe, expect, it } from 'vitest'
import {
  measureCode,
  splitMarkers,
  type CodeBlockInput,
} from './codeMetrics.js'

const block = (
  lines: string[],
  extra: Partial<CodeBlockInput> = {}
): CodeBlockInput => ({
  repo: 'repo-a',
  lines,
  text: lines.join('\n'),
  isDoc: false,
  lang: 'ru',
  year: 2020,
  ...extra,
})

describe('measureCode', () => {
  it('measures inline and doc genres apart', () => {
    const m = measureCode([
      block(['Коротко.']),
      block(['Тоже коротко.']),
      block(['Первая строка.', 'Вторая.', 'Третья.'], { isDoc: true }),
      block(['Раз.', 'Два.', 'Три.', 'Четыре.'], { isDoc: true }),
    ])

    expect(m.genres.code.blockLines.median).toBe(1)
    expect(m.genres.jsdoc.blockLines.median).toBeGreaterThan(1)
    expect(m.genres.code.blocks).toBe(2)
    expect(m.genres.jsdoc.blocks).toBe(2)
  })

  it('counts causal connectives, which is what makes a comment explain', () => {
    const m = measureCode([
      block(['Так сделано потому что иначе ломается сборка.']),
      block(['Просто факт.']),
    ])
    const phrases = m.connectives.map(c => c.phrase)
    expect(phrases).toContain('потому что')
    expect(phrases).toContain('иначе')
  })

  it('separates own markers from foreign ones', () => {
    const m = measureCode([
      block(['TODO: Доделать.']),
      block(['NOTE: Неочевидно.']),
      block(['FIXME: чужой маркер']),
    ])
    const byName = Object.fromEntries(m.markers.map(x => [x.name, x.count]))
    expect(byName.TODO).toBe(1)
    expect(byName.NOTE).toBe(1)
    expect(byName.FIXME).toBe(1)
  })

  it("treats a marker seen a couple of times as somebody else's", () => {
    const m = measureCode([
      ...Array.from({ length: 40 }, () => block(['TODO: Доделать.'])),
      ...Array.from({ length: 6 }, () => block(['NOTE: Неочевидно.'])),
      block(['FIXME: чужой маркер']),
    ])
    const { own, foreign } = splitMarkers(m)
    expect(own).toEqual(['TODO', 'NOTE'])
    expect(foreign).toContain('FIXME')
    expect(foreign).toContain('IMPORTANT')
  })

  it('claims no markers for a corpus without any', () => {
    expect(splitMarkers(measureCode([block(['Просто факт.'])])).own).toEqual([])
  })

  it('reports the language split and the repositories', () => {
    const m = measureCode([
      block(['Русский комментарий.']),
      block(['English comment here.'], { lang: 'en', repo: 'repo-b' }),
    ])
    expect(m.russian).toBe(0.5)
    expect(m.repos.map(r => r.repo).sort()).toEqual(['repo-a', 'repo-b'])
  })

  it('counts typography only over the handwritten years', () => {
    const handwritten = Array.from({ length: 200 }, () =>
      block(['Кеш живёт до перезапуска -- дольше не нужно.'], { year: 2023 })
    )
    const assisted = Array.from({ length: 400 }, () =>
      block(['Кеш живёт до перезапуска — дольше не нужно.'], { year: 2026 })
    )
    const blocks = [...handwritten, ...assisted]

    const dash = (m: ReturnType<typeof measureCode>) =>
      m.typography?.code?.find(a => a.label === 'длинное тире —')?.share

    expect(dash(measureCode(blocks))).toBeCloseTo(66.667)
    expect(dash(measureCode(blocks, 2026))).toBe(0)
  })

  it('leaves a genre unmeasured when the window keeps too few lines', () => {
    const blocks = [
      block(['Ещё до всего.'], { year: 2023 }),
      ...Array.from({ length: 300 }, () => block(['Свежее.'], { year: 2026 })),
    ]
    expect(measureCode(blocks, 2026).typography?.code).toBeUndefined()
    expect(measureCode(blocks).typography?.code).toBeDefined()
  })

  it('survives an empty corpus', () => {
    const m = measureCode([])
    expect(m.blocks).toBe(0)
    expect(m.genres.code.lineWidth.median).toBe(0)
  })
})
