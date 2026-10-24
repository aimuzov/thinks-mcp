import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, describe, it } from 'node:test'

import { openDb } from '#thinks/store/db'

import { BlameCache } from './cache.ts'
import { emptyScanStats, isRepo, scanRepo, type CodeComment } from './scan.ts'

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
		].join('\n'),
	)

	writeFileSync(join(dir, 'notes.md'), '# Не индексируем markdown\n')
	run(dir, ['add', '.'])
	run(dir, ['commit', '-qm', 'mine'], ME)

	writeFileSync(join(dir, 'theirs.ts'), ['// Чужой комментарий.', 'const b = 2'].join('\n'))
	run(dir, ['add', '.'])
	run(dir, ['commit', '-qm', 'theirs'])

	return dir
}

let repo: string
let found: CodeComment[]

before(() => {
	repo = makeRepo()
	found = scanRepo(repo, { emails: [ME] }, emptyScanStats())
})

describe('scanRepo', () => {
	it('keeps the owner comments', () => {
		const texts = found.map((c) => c.text)

		assert.ok(texts.includes('Мой комментарий про причину.\nВторая строка той же мысли.'))
		assert.ok(texts.includes('Док-блок автора.'))
	})

	it('drops comments written by someone else', () => {
		assert.ok(!found.map((c) => c.text).includes('Чужой комментарий.'))
	})

	it('marks doc blocks apart from inline ones', () => {
		const doc = found.find((c) => c.text.includes('Док-блок'))
		const inline = found.find((c) => c.text.includes('Мой комментарий'))

		assert.equal(doc?.isDoc, true)
		assert.equal(inline?.isDoc, false)
	})

	it('records the repository by name, never by path', () => {
		assert.equal(
			found.every((c) => !c.repo.includes('/')),
			true,
		)
	})

	it('tags the language and a plausible year', () => {
		assert.equal(
			found.every((c) => c.lang === 'ru'),
			true,
		)

		assert.equal(
			found.every((c) => c.year >= 2000),
			true,
		)
	})

	it('ignores files whose extension has no comment syntax', () => {
		assert.equal(
			found.some((c) => c.text.includes('markdown')),
			false,
		)
	})

	it('counts what it skipped', () => {
		const stats = emptyScanStats()

		scanRepo(repo, { emails: [ME] }, stats)
		assert.ok(stats.kept > 0)
		assert.ok(stats.blocks >= stats.kept)
	})

	it('drops section rules and commented-out code', () => {
		const texts = found.map((c) => c.text)

		assert.equal(
			texts.some((t) => /^-+$/.test(t)),
			false,
		)

		assert.equal(
			texts.some((t) => t.includes('oldCall(')),
			false,
		)
	})
})

describe('blame cache', () => {
	it('returns the same comments without blaming again', () => {
		const db = openDb(':memory:')
		const cache = new BlameCache(db)

		const first = emptyScanStats()
		const cold = scanRepo(repo, { emails: [ME] }, first, cache)

		assert.ok(first.filesBlamed > 0)
		assert.equal(first.filesCached, 0)

		const second = emptyScanStats()
		const warm = scanRepo(repo, { emails: [ME] }, second, cache)

		assert.equal(second.filesBlamed, 0)
		assert.equal(second.filesCached, first.filesBlamed)

		assert.deepEqual(
			warm.map((c) => c.text),
			cold.map((c) => c.text),
		)
	})

	it('survives a round trip through the database', () => {
		const db = openDb(':memory:')
		const writer = new BlameCache(db)

		scanRepo(repo, { emails: [ME] }, emptyScanStats(), writer)
		writer.flush()

		// A fresh instance reads what the previous build wrote.
		const reader = new BlameCache(db)

		assert.equal(reader.size, writer.size)

		const stats = emptyScanStats()

		scanRepo(repo, { emails: [ME] }, stats, reader)
		assert.equal(stats.filesBlamed, 0)
		assert.ok(stats.filesCached > 0)
	})

	it('re-blames a file after its contents change', () => {
		const db = openDb(':memory:')
		const cache = new BlameCache(db)

		scanRepo(repo, { emails: [ME] }, emptyScanStats(), cache)

		writeFileSync(join(repo, 'mine.ts'), ['// Совсем новый комментарий.', 'const a = 1'].join('\n'))
		run(repo, ['add', '.'])
		run(repo, ['commit', '-qm', 'change'], ME)

		const stats = emptyScanStats()
		const found = scanRepo(repo, { emails: [ME] }, stats, cache)

		assert.equal(stats.filesBlamed, 1)
		assert.ok(found.map((c) => c.text).includes('Совсем новый комментарий.'))
	})
})

describe('isRepo', () => {
	it('recognises a repository and rejects a plain directory', () => {
		assert.equal(isRepo(repo), true)
		assert.equal(isRepo(mkdtempSync(join(tmpdir(), 'thinks-plain-'))), false)
	})
})
