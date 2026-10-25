import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { loadConfig, type Config } from '#thinks/config'
import { buildCorpus } from '#thinks/corpus/build'
import { getMeta, openDb } from '#thinks/store/db'
import { loadProfile } from '#thinks/style/profile'
import { makeDump } from '#thinks/testing/fixtures'
import { makeRepo, REPO_OWNER_EMAIL } from '#thinks/testing/repo'

import { buildCodeCorpus, formatCodeReport } from './build.ts'

const freshConfig = (): Config => loadConfig({ THINKS_DATA_DIR: mkdtempSync(join(tmpdir(), 'thinks-code-')) })

/** Корпус переписки, рядом с которым должен лечь корпус кода. */
function withChatCorpus(): Config {
	const cfg = freshConfig()
	const dumpPath = join(cfg.dataDir, 'dump.json')

	writeFileSync(dumpPath, JSON.stringify(makeDump()))
	buildCorpus({ ...cfg, dumpPath })

	return cfg
}

describe('buildCodeCorpus', () => {
	it('без единого репозитория падает, не тронув корпус', () => {
		const cfg = freshConfig()
		const plain = mkdtempSync(join(tmpdir(), 'thinks-plain-'))

		assert.throws(() => buildCodeCorpus(cfg, [plain], ['me@example.com']), /корпус кода не тронут/)
		assert.equal(existsSync(cfg.dbPath), false)
	})

	it('не трогает уже собранный корпус, когда ни один путь не репозиторий', () => {
		const cfg = withChatCorpus()
		const before = readFileSync(cfg.dbPath)

		assert.throws(() => buildCodeCorpus(cfg, ['/nonexistent/path'], [REPO_OWNER_EMAIL]), /корпус кода не тронут/)
		assert.deepEqual(readFileSync(cfg.dbPath), before)
	})

	it('собирает комментарии владельца из git-репозитория', () => {
		const cfg = freshConfig()
		const repo = makeRepo()
		const logged: string[] = []
		const report = buildCodeCorpus(cfg, [repo], [REPO_OWNER_EMAIL], (msg) => logged.push(msg))

		assert.equal(report.blocks, 3)
		assert.equal(report.inline, 2)
		assert.equal(report.doc, 1)
		assert.deepEqual(report.repos, [{ repo: 'secret-employer-repo', blocks: 3 }])
		assert.ok(logged.some((l) => l.endsWith('secret-employer-repo: 3')))

		const db = openDb(cfg.dbPath)
		const rows = db.prepare('SELECT register, chat_key, text, context_in FROM turn ORDER BY id').all() as {
			register: string
			chat_key: string
			text: string
			context_in: string
		}[]

		assert.deepEqual(rows.map((r) => r.register).sort(), ['code', 'code', 'jsdoc'])
		// Имя репозитория выдаёт работодателя, поэтому в базу оно не попадает.
		assert.ok(rows.every((r) => !r.chat_key.includes('secret-employer')))
		assert.ok(rows.some((r) => r.context_in.includes('const RETRIES = 3')))
		assert.ok(!rows.some((r) => r.text.includes('Чужой')))
		assert.equal(getMeta(db, 'code_emails'), REPO_OWNER_EMAIL)
		assert.ok(loadProfile(db)?.code)
		assert.ok(!JSON.stringify(loadProfile(db)).includes('secret-employer'))
		db.close()
	})

	it('пропускает пути, которые не репозиторий, и собирает остальные', () => {
		const cfg = freshConfig()
		const logged: string[] = []
		const report = buildCodeCorpus(cfg, ['/nonexistent/path', makeRepo()], [REPO_OWNER_EMAIL], (msg) =>
			logged.push(msg),
		)

		assert.equal(report.blocks, 3)
		assert.ok(logged.includes('Пропускаю (не git-репозиторий): /nonexistent/path'))
	})

	it('кладёт корпус кода рядом с перепиской, не стирая её', () => {
		const cfg = withChatCorpus()

		buildCodeCorpus(cfg, [makeRepo()], [REPO_OWNER_EMAIL])

		const db = openDb(cfg.dbPath)
		const profile = loadProfile(db)
		const registers = db.prepare('SELECT DISTINCT register FROM turn').all() as { register: string }[]

		assert.ok(profile?.code)
		assert.ok(profile?.registers.dm)
		assert.deepEqual(registers.map((r) => r.register).sort(), ['code', 'dm', 'group', 'jsdoc'])
		db.close()
	})

	it('пересобирает корпус кода с нуля и берёт неизменённые файлы из кеша', () => {
		const cfg = freshConfig()
		const repo = makeRepo()
		const first = buildCodeCorpus(cfg, [repo], [REPO_OWNER_EMAIL])
		const second = buildCodeCorpus(cfg, [repo], [REPO_OWNER_EMAIL])

		assert.ok(first.filesBlamed > 0)
		assert.equal(first.filesCached, 0)
		assert.equal(second.filesBlamed, 0)
		assert.ok(second.filesCached > 0)

		const db = openDb(cfg.dbPath)
		const { n } = db.prepare("SELECT count(*) AS n FROM turn WHERE register IN ('code', 'jsdoc')").get() as {
			n: number
		}

		// Повторная сборка заменяет блоки, а не добавляет их второй раз.
		assert.equal(n, second.blocks)
		db.close()
	})

	it('не находит ничего у чужого автора, но корпус кода всё равно сохраняет', () => {
		const cfg = freshConfig()
		const report = buildCodeCorpus(cfg, [makeRepo()], ['nobody@example.com'])

		assert.equal(report.blocks, 0)
		assert.deepEqual(report.repos, [])

		const db = openDb(cfg.dbPath)

		assert.ok(loadProfile(db)?.code)
		db.close()
	})
})

describe('formatCodeReport', () => {
	it('печатает итоги сборки и репозитории по убыванию', () => {
		const text = formatCodeReport({
			repos: [
				{ repo: 'big', blocks: 1200 },
				{ repo: 'small', blocks: 3 },
			],
			blocks: 1203,
			inline: 1000,
			doc: 203,
			russian: 0.456,
			skippedOther: 7,
			skippedNoise: 2,
			filesBlamed: 40,
			filesCached: 10,
		})

		assert.match(text, /Блоков комментариев:\s+1\s?203/)
		assert.match(text, /По-русски:\s+46%/)
		assert.match(text, /Взято из кеша:\s+10/)
		assert.ok(text.indexOf('big') < text.indexOf('small'))
	})

	it('показывает не больше двадцати репозиториев', () => {
		const repos = Array.from({ length: 25 }, (_, i) => ({ repo: `repo-${i}`, blocks: 25 - i }))
		const text = formatCodeReport({
			repos,
			blocks: 0,
			inline: 0,
			doc: 0,
			russian: 0,
			skippedOther: 0,
			skippedNoise: 0,
			filesBlamed: 0,
			filesCached: 0,
		})

		assert.ok(text.includes('repo-19'))
		assert.ok(!text.includes('repo-20'))
	})
})
