import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { textOf } from '@aimuzov/infra-mcp-kit/testing'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import { openDb } from '#thinks/store/db'
import { makeDump } from '#thinks/testing/fixtures'
import { makeRepo, REPO_OWNER_EMAIL } from '#thinks/testing/repo'

const ENTRY = fileURLToPath(new URL('./index.ts', import.meta.url))
const NODE_ARGS = ['--conditions=thinks-source', ENTRY]

type Sandbox = { dataDir: string; env: Record<string, string> }

/**
 * Свой каталог данных и свой «домашний» git-конфиг: CLI не должен видеть ни
 * корпус, ни git-email того, кто запускает тесты.
 */
function sandbox(extra: Record<string, string> = {}): Sandbox {
	const root = mkdtempSync(join(tmpdir(), 'thinks-cli-'))
	const gitconfig = join(root, 'gitconfig')

	writeFileSync(gitconfig, '')

	const dataDir = join(root, 'data')

	return {
		dataDir,
		env: {
			PATH: process.env.PATH ?? '',
			HOME: root,
			THINKS_DATA_DIR: dataDir,
			GIT_CONFIG_GLOBAL: gitconfig,
			GIT_CONFIG_NOSYSTEM: '1',
			...extra,
		},
	}
}

function cli(box: Sandbox, args: string[], extraEnv: Record<string, string> = {}) {
	const res = spawnSync(process.execPath, [...NODE_ARGS, ...args], {
		encoding: 'utf8',
		env: { ...box.env, ...extraEnv },
	})

	return { code: res.status, stdout: res.stdout, stderr: res.stderr }
}

function dumpFile(): string {
	const path = join(mkdtempSync(join(tmpdir(), 'thinks-cli-dump-')), 'result.json')

	writeFileSync(path, JSON.stringify(makeDump()))

	return path
}

/** Корпус переписки, собранный самим CLI. */
function built(extra: Record<string, string> = {}): Sandbox {
	const box = sandbox(extra)
	const res = cli(box, ['build', dumpFile()])

	assert.equal(res.code, 0, res.stderr)

	return box
}

const dbPath = (box: Sandbox) => join(box.dataDir, 'style.db')

describe('CLI', () => {
	it('печатает справку и версию', () => {
		const box = sandbox()
		const help = cli(box, ['--help'])

		assert.equal(help.code, 0)
		assert.match(help.stdout, /^Usage: thinks-mcp/)

		const version = cli(box, ['--version'])
		const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

		assert.equal(version.stdout.trim(), pkg.version)
	})

	it('отвечает кодом 2 на неизвестную команду', () => {
		const res = cli(sandbox(), ['frobnicate'])

		assert.equal(res.code, 2)
		assert.match(res.stderr, /Неизвестная команда: frobnicate/)
	})

	it('where показывает, собран ли корпус', () => {
		const empty = sandbox()

		assert.match(cli(empty, ['where']).stdout, /Собран:\s+нет/)

		const box = built()
		const res = cli(box, ['where'])

		assert.ok(res.stdout.includes(`Индекс:         ${dbPath(box)}`))
		assert.match(res.stdout, /Собран:\s+да/)
	})

	describe('build', () => {
		it('падает, когда выгрузки нет', () => {
			const res = cli(sandbox(), ['build', '/nonexistent/result.json'])

			assert.equal(res.code, 1)
			assert.match(res.stderr, /Выгрузка не найдена: \/nonexistent\/result\.json/)
		})

		it('берёт выгрузку из THINKS_DUMP, когда путь не передан', () => {
			const box = sandbox()
			const res = cli(box, ['build'], { THINKS_DUMP: dumpFile() })

			assert.equal(res.code, 0, res.stderr)
			assert.match(res.stderr, /Ходов в корпусе:/)
			assert.ok(res.stderr.includes(`Индекс: ${dbPath(box)}`))
			assert.ok(existsSync(dbPath(box)))
		})
	})

	describe('profile', () => {
		it('объясняет, что корпус не собран', () => {
			const res = cli(sandbox(), ['profile'])

			assert.equal(res.code, 1)
			assert.match(res.stderr, /thinks-mcp build/)
		})

		it('отказывает в неизвестном регистре', () => {
			const res = cli(sandbox(), ['profile', 'tweets'])

			assert.equal(res.code, 1)
			assert.match(res.stderr, /Неизвестный регистр: tweets\. Доступны: dm, group, longform, code, jsdoc/)
		})

		it('печатает профиль собранного корпуса', () => {
			const res = cli(built(), ['profile', 'group'])

			assert.equal(res.code, 0, res.stderr)
			assert.match(res.stdout, /Как я пишу/)
		})
	})

	describe('holdout', () => {
		it('просит пересобрать корпус, когда отложенных пар нет', () => {
			const res = cli(built({ THINKS_HOLDOUT: '0' }), ['holdout'])

			assert.equal(res.code, 1)
			assert.match(res.stderr, /Отложенных пар нет/)
		})

		it('показывает входящие, а ответы только с --answers', () => {
			const box = built({ THINKS_HOLDOUT: '1' })
			const plain = cli(box, ['holdout'])

			assert.equal(plain.code, 0, plain.stderr)
			assert.match(plain.stdout, /^\[1\] /)
			assert.match(plain.stdout, /Входящее: /)
			assert.doesNotMatch(plain.stdout, /Ответ: /)
			assert.match(cli(box, ['holdout', '--answers']).stdout, /Ответ: /)
		})
	})

	describe('export', () => {
		it('требует путь и не затирает существующий файл', () => {
			const box = built()

			assert.match(cli(box, ['export']).stderr, /Укажи файл/)

			const taken = join(box.dataDir, 'taken.db')

			writeFileSync(taken, 'keep')

			const res = cli(box, ['export', taken])

			assert.equal(res.code, 1)
			assert.match(res.stderr, /Файл уже есть/)
			assert.equal(readFileSync(taken, 'utf8'), 'keep')
		})

		it('пишет копию корпуса без кеша git blame', () => {
			const box = built()

			assert.equal(cli(box, ['code', makeRepo()], { THINKS_CODE_EMAILS: REPO_OWNER_EMAIL }).code, 0)

			const dest = join(box.dataDir, 'server.db')
			const res = cli(box, ['export', dest])

			assert.equal(res.code, 0, res.stderr)

			const db = openDb(dest)
			const { n } = db.prepare('SELECT count(*) AS n FROM blame_cache').get() as { n: number }
			const { turns } = db.prepare('SELECT count(*) AS turns FROM turn').get() as { turns: number }

			assert.equal(n, 0)
			assert.ok(turns > 0)
			db.close()
		})
	})

	describe('code', () => {
		it('требует хотя бы один путь', () => {
			const res = cli(sandbox(), ['code'])

			assert.equal(res.code, 1)
			assert.match(res.stderr, /Укажи хотя бы один репозиторий/)
		})

		it('без git-email падает, ничего не собрав', () => {
			const box = sandbox()
			const res = cli(box, ['code', makeRepo()])

			assert.equal(res.code, 1)
			assert.match(res.stderr, /THINKS_CODE_EMAILS/)
			assert.equal(existsSync(dbPath(box)), false)
		})

		it('без единого репозитория падает и не стирает корпус', () => {
			const box = built()

			assert.equal(cli(box, ['code', makeRepo()], { THINKS_CODE_EMAILS: REPO_OWNER_EMAIL }).code, 0)

			const before = readFileSync(dbPath(box))
			const mtime = statSync(dbPath(box)).mtimeMs
			const plain = mkdtempSync(join(tmpdir(), 'thinks-plain-'))
			const res = cli(box, ['code', plain], { THINKS_CODE_EMAILS: REPO_OWNER_EMAIL })

			assert.equal(res.code, 1)
			assert.match(res.stderr, /корпус кода не тронут/)
			assert.deepEqual(readFileSync(dbPath(box)), before)
			assert.equal(statSync(dbPath(box)).mtimeMs, mtime)

			const db = openDb(dbPath(box))
			const { n } = db.prepare("SELECT count(*) AS n FROM turn WHERE register IN ('code', 'jsdoc')").get() as {
				n: number
			}

			assert.equal(n, 3)
			db.close()
		})

		it('собирает корпус кода с адресом из THINKS_CODE_EMAILS', () => {
			const box = sandbox()
			const res = cli(box, ['code', makeRepo()], { THINKS_CODE_EMAILS: REPO_OWNER_EMAIL })

			assert.equal(res.code, 0, res.stderr)
			assert.ok(res.stderr.includes(`Автор: ${REPO_OWNER_EMAIL}`))
			assert.match(res.stderr, /Блоков комментариев:\s+3/)
			assert.match(cli(box, ['profile', 'jsdoc']).stdout, /Как я комментирую код -- JSDoc/)
		})

		it('берёт адрес из глобального git config, когда THINKS_CODE_EMAILS не задан', () => {
			const box = sandbox()

			writeFileSync(box.env.GIT_CONFIG_GLOBAL!, `[user]\n\temail = ${REPO_OWNER_EMAIL}\n`)

			const res = cli(box, ['code', makeRepo(), '--verbose'])

			assert.equal(res.code, 0, res.stderr)
			assert.ok(res.stderr.includes(`Автор: ${REPO_OWNER_EMAIL}`))
		})
	})

	describe('serve', () => {
		it('по умолчанию отвечает по MCP на stdio, даже без корпуса', async () => {
			const box = sandbox()
			const client = new Client({ name: 'cli-test', version: '0' })

			await client.connect(
				new StdioClientTransport({
					command: process.execPath,
					args: NODE_ARGS,
					env: box.env,
					stderr: 'ignore',
				}),
			)

			try {
				const { tools } = await client.listTools()

				assert.equal(tools.length, 5)

				const result = await client.callTool({ name: 'write_as_me', arguments: { brief: 'что угодно' } })

				assert.equal(result.isError, true)
				assert.match(textOf(result), /thinks-mcp build/)
			} finally {
				await client.close()
			}
		})
	})
})
