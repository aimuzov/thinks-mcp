import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import type { Config } from '#thinks/config'
import { buildCorpus } from '#thinks/corpus/build'
import { makeDump } from '#thinks/testing/fixtures'

import { createServer } from './server.ts'

/** Build a real corpus from the fixture dump, then serve it. */
function seededConfig(): Config {
	const dir = mkdtempSync(join(tmpdir(), 'thinks-mcp-'))
	const dumpPath = join(dir, 'dump.json')
	writeFileSync(dumpPath, JSON.stringify(makeDump()), 'utf8')

	const cfg: Config = {
		dumpPath,
		dataDir: dir,
		dbPath: join(dir, 'style.db'),
		ownerId: '',
		chatStopList: [],
		burstWindowSeconds: 90,
		longformMinChars: 300,
		holdoutSize: 0,
		codeEmails: [],
		recentYears: 3,
		codeHandwrittenUntil: 0,
		neverMarks: [],
		voice: false,
	}
	buildCorpus(cfg)
	return cfg
}

async function connect(cfg: Config) {
	const server = createServer(cfg)
	const client = new Client({ name: 'test', version: '0.0.0' })
	const [clientT, serverT] = InMemoryTransport.createLinkedPair()
	await Promise.all([server.connect(serverT), client.connect(clientT)])
	return client
}

const textOf = (result: unknown): string =>
	((result as { content: { type: string; text: string }[] }).content ?? [])
		.filter((c) => c.type === 'text')
		.map((c) => c.text)
		.join('\n')

// A resource may carry a blob instead of text; the profile is always text.
const textOfResource = (c: { text?: string; blob?: string }): string => String(c.text ?? '')

let cfg: Config

beforeEach(() => {
	cfg = seededConfig()
})

describe('MCP server (end to end)', () => {
	it('registers every tool', async () => {
		const client = await connect(cfg)
		const { tools } = await client.listTools()
		assert.deepEqual(tools.map((t) => t.name).sort(), [
			'check_as_me',
			'find_my_messages',
			'rephrase_as_me',
			'reply_as_me',
			'write_as_me',
		])
	})

	it('write_as_me returns a brief with profile, examples and contract', async () => {
		const client = await connect(cfg)
		const text = textOf(
			await client.callTool({
				name: 'write_as_me',
				arguments: { brief: 'напиши, что задержусь' },
			}),
		)

		assert.ok(text.includes('# ЗАДАЧА'))
		assert.ok(text.includes('# ПРИМЕРЫ ИЗ АРХИВА'))
		assert.ok(text.includes('# ОГРАНИЧЕНИЯ'))
		assert.ok(text.includes('# ФОРМАТ ОТВЕТА'))
		// The brief must carry real messages, not just a description of them.
		assert.match(text, /Через час\.|Вышел\./)
	})

	it('reply_as_me shows what was said before the answer', async () => {
		const client = await connect(cfg)
		const text = textOf(
			await client.callTool({
				name: 'reply_as_me',
				arguments: { incoming: 'Ты когда освободишься?' },
			}),
		)

		assert.ok(text.includes('Ты когда освободишься?'))
		assert.ok(text.includes('Через час.'))
		// The fixture pair is inferred from message order, not quoted, and the
		// brief has to say so rather than presenting it as a real answer.
		assert.ok(text.includes('Перед этим написали:'))
	})

	it('check_as_me scores text and returns structured findings', async () => {
		const client = await connect(cfg)
		const result = await client.callTool({
			name: 'check_as_me',
			arguments: { text: 'Однако следует отметить:\n- первое\n- второе' },
		})

		const report = (
			result as unknown as {
				structuredContent: { score: number; findings: unknown[] }
			}
		).structuredContent
		assert.ok(report.score < 80)
		assert.ok(report.findings.length > 0)
		assert.ok(textOf(result).includes('Оценка:'))
	})

	it('find_my_messages searches the archive', async () => {
		const client = await connect(cfg)
		const text = textOf(
			await client.callTool({
				name: 'find_my_messages',
				arguments: { query: 'сантехник' },
			}),
		)
		assert.ok(text.includes('Сантехника вызывает'))
	})

	it('serves the style profile as a resource', async () => {
		const client = await connect(cfg)
		const { contents } = await client.readResource({ uri: 'style://profile' })
		assert.ok(textOfResource(contents[0]).includes('Как я пишу'))
	})

	it('exposes the prompts', async () => {
		const client = await connect(cfg)
		const { prompts } = await client.listPrompts()
		assert.deepEqual(prompts.map((p) => p.name).sort(), ['as-me', 'comment-as-me', 'reply-as-me', 'talk-like-me'])
	})

	it('holds declared marks against every brief and every check', async () => {
		const client = await connect({
			...cfg,
			neverMarks: [
				{ mark: '…', standIn: '...' },
				{ mark: '—', standIn: '--' },
				{ mark: '→', standIn: '=>' },
			],
		})

		const briefs = [
			{ name: 'write_as_me', arguments: { brief: 'напиши, что задержусь' } },
			{
				name: 'reply_as_me',
				arguments: { incoming: 'Ты когда освободишься?' },
			},
			{ name: 'rephrase_as_me', arguments: { text: 'Я немного задержусь.' } },
		]
		for (const call of briefs) {
			assert.ok(
				textOf(await client.callTool(call)).includes('`...` вместо …, `--` вместо —, `=>` вместо →'),
				call.name,
			)
		}

		for (const register of ['dm', 'group', 'longform']) {
			const result = await client.callTool({
				name: 'check_as_me',
				arguments: { text: 'Буду через час — может… позже.', register },
			})
			const report = result.structuredContent as {
				findings: { issue: string; fragment?: string }[]
			}
			assert.deepEqual(
				report.findings.filter((f) => f.issue === 'Знак, который я не набираю').map((f) => f.fragment),
				['— может… позже.', 'час — может…'],
				register,
			)
		}
	})

	it('accepts every register the corpus can hold', async () => {
		// The zod enum and the Register type drifted apart once: the type gained
		// code/jsdoc while the schema still rejected them at the protocol edge.
		const client = await connect(cfg)
		for (const register of ['dm', 'group', 'longform', 'code', 'jsdoc']) {
			const result = await client.callTool({
				name: 'find_my_messages',
				arguments: { query: 'что угодно', register, limit: 2 },
			})
			assert.ok(!textOf(result).includes('Input validation error'), `register=${register} отвергнут схемой`)
		}
	})

	it('starts without a corpus and explains how to build one', async () => {
		// The server lives in a global MCP config; a machine with no archive must
		// still get a working server rather than a dead entry in the list.
		const client = await connect({
			...cfg,
			dbPath: join(cfg.dataDir, 'missing.db'),
		})

		const { tools } = await client.listTools()
		assert.equal(tools.length, 5)

		const result = await client.callTool({
			name: 'write_as_me',
			arguments: { brief: 'что угодно' },
		})
		assert.equal((result as { isError?: boolean }).isError, true)
		assert.ok(textOf(result).includes('thinks-mcp build'))

		const { contents } = await client.readResource({ uri: 'style://profile' })
		assert.ok(textOfResource(contents[0]).includes('thinks-mcp build'))
	})

	it('picks up a corpus built after startup, without a restart', async () => {
		const dbPath = join(cfg.dataDir, 'later.db')
		const client = await connect({ ...cfg, dbPath })

		assert.equal(
			(
				(await client.callTool({
					name: 'find_my_messages',
					arguments: { query: 'сантехник' },
				})) as { isError?: boolean }
			).isError,
			true,
		)

		buildCorpus({ ...cfg, dbPath })

		const after = await client.callTool({
			name: 'find_my_messages',
			arguments: { query: 'сантехник' },
		})
		assert.ok(!(after as { isError?: boolean }).isError)
		assert.ok(textOf(after).includes('Сантехника вызывает'))
	})
})
