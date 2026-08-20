import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyScanStats, isRepo, scanRepo, type CodeComment } from './scan.js'
import { BlameCache } from './cache.js'
import { openDb } from '../store/db.js'

const ME = 'me@example.com'
const OTHER = 'other@example.com'

function run(repo: string, args: string[], email?: string) {
  execFileSync('git', ['-C', repo, ...args], {
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: email ? 'A' : 'B',
      GIT_AUTHOR_EMAIL: email ?? OTHER,
      GIT_COMMITTER_NAME: 'C',
      GIT_COMMITTER_EMAIL: 'c@example.com',
    },
  })
}

/**
 * A real repository with two authors: the only honest way to check that blame
 * parsing and the ownership rule agree with git.
 */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'thinks-scan-'))
  run(dir, ['init', '-q'])

  writeFileSync(
    join(dir, 'mine.ts'),
    [
      '// Мой комментарий про причину.',
      '// Вторая строка той же мысли.',
      'const a = 1',
      '',
      '/**',
      ' * Док-блок автора.',
      ' */',
      'export function f() {}',
      '',
      '// ---------------------------------------',
      'const c = 3',
      '',
      '// oldCall({ a: 1, b: 2 });',
      'const d = 4',
    ].join('\n')
  )
  writeFileSync(join(dir, 'notes.md'), '# Не индексируем markdown\n')
  run(dir, ['add', '.'])
  run(dir, ['commit', '-qm', 'mine'], ME)

  writeFileSync(
    join(dir, 'theirs.ts'),
    ['// Чужой комментарий.', 'const b = 2'].join('\n')
  )
  run(dir, ['add', '.'])
  run(dir, ['commit', '-qm', 'theirs'])

  return dir
}

let repo: string
let found: CodeComment[]

beforeAll(() => {
  repo = makeRepo()
  found = scanRepo(repo, { emails: [ME] }, emptyScanStats())
})

describe('scanRepo', () => {
  it('keeps the owner comments', () => {
    const texts = found.map(c => c.text)
    expect(texts).toContain(
      'Мой комментарий про причину.\nВторая строка той же мысли.'
    )
    expect(texts).toContain('Док-блок автора.')
  })

  it('drops comments written by someone else', () => {
    expect(found.map(c => c.text)).not.toContain('Чужой комментарий.')
  })

  it('marks doc blocks apart from inline ones', () => {
    const doc = found.find(c => c.text.includes('Док-блок'))
    const inline = found.find(c => c.text.includes('Мой комментарий'))
    expect(doc?.isDoc).toBe(true)
    expect(inline?.isDoc).toBe(false)
  })

  it('records the repository by name, never by path', () => {
    expect(found.every(c => !c.repo.includes('/'))).toBe(true)
  })

  it('tags the language and a plausible year', () => {
    expect(found.every(c => c.lang === 'ru')).toBe(true)
    expect(found.every(c => c.year >= 2000)).toBe(true)
  })

  it('ignores files whose extension has no comment syntax', () => {
    expect(found.some(c => c.text.includes('markdown'))).toBe(false)
  })

  it('counts what it skipped', () => {
    const stats = emptyScanStats()
    scanRepo(repo, { emails: [ME] }, stats)
    expect(stats.kept).toBeGreaterThan(0)
    expect(stats.blocks).toBeGreaterThanOrEqual(stats.kept)
  })

  it('drops section rules and commented-out code', () => {
    const texts = found.map(c => c.text)
    expect(texts.some(t => /^-+$/.test(t))).toBe(false)
    expect(texts.some(t => t.includes('oldCall('))).toBe(false)
  })
})

describe('blame cache', () => {
  it('returns the same comments without blaming again', () => {
    const db = openDb(':memory:')
    const cache = new BlameCache(db)

    const first = emptyScanStats()
    const cold = scanRepo(repo, { emails: [ME] }, first, cache)
    expect(first.filesBlamed).toBeGreaterThan(0)
    expect(first.filesCached).toBe(0)

    const second = emptyScanStats()
    const warm = scanRepo(repo, { emails: [ME] }, second, cache)
    expect(second.filesBlamed).toBe(0)
    expect(second.filesCached).toBe(first.filesBlamed)
    expect(warm.map(c => c.text)).toEqual(cold.map(c => c.text))
  })

  it('survives a round trip through the database', () => {
    const db = openDb(':memory:')
    const writer = new BlameCache(db)
    scanRepo(repo, { emails: [ME] }, emptyScanStats(), writer)
    writer.flush()

    // A fresh instance reads what the previous build wrote.
    const reader = new BlameCache(db)
    expect(reader.size).toBe(writer.size)

    const stats = emptyScanStats()
    scanRepo(repo, { emails: [ME] }, stats, reader)
    expect(stats.filesBlamed).toBe(0)
    expect(stats.filesCached).toBeGreaterThan(0)
  })

  it('re-blames a file after its contents change', () => {
    const db = openDb(':memory:')
    const cache = new BlameCache(db)
    scanRepo(repo, { emails: [ME] }, emptyScanStats(), cache)

    writeFileSync(
      join(repo, 'mine.ts'),
      ['// Совсем новый комментарий.', 'const a = 1'].join('\n')
    )
    run(repo, ['add', '.'])
    run(repo, ['commit', '-qm', 'change'], ME)

    const stats = emptyScanStats()
    const found = scanRepo(repo, { emails: [ME] }, stats, cache)
    expect(stats.filesBlamed).toBe(1)
    expect(found.map(c => c.text)).toContain('Совсем новый комментарий.')
  })
})

describe('isRepo', () => {
  it('recognises a repository and rejects a plain directory', () => {
    expect(isRepo(repo)).toBe(true)
    expect(isRepo(mkdtempSync(join(tmpdir(), 'thinks-plain-')))).toBe(false)
  })
})
