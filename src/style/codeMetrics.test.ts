import { describe, expect, it } from 'vitest'
import { measureCode, type CodeBlockInput } from './codeMetrics.js'

const block = (
  lines: string[],
  extra: Partial<CodeBlockInput> = {}
): CodeBlockInput => ({
  repo: 'repo-a',
  lines,
  text: lines.join('\n'),
  isDoc: false,
  lang: 'ru',
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

  it('reports the language split and the repositories', () => {
    const m = measureCode([
      block(['Русский комментарий.']),
      block(['English comment here.'], { lang: 'en', repo: 'repo-b' }),
    ])
    expect(m.russian).toBe(0.5)
    expect(m.repos.map(r => r.repo).sort()).toEqual(['repo-a', 'repo-b'])
  })

  it('survives an empty corpus', () => {
    const m = measureCode([])
    expect(m.blocks).toBe(0)
    expect(m.genres.code.lineWidth.median).toBe(0)
  })
})
