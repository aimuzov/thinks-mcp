import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { before, describe, it } from 'node:test'
import { connectInMemory, textOf } from '@aimuzov/infra-mcp-kit/testing'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { emptyConfig, seededConfig } from '#thinks/testing/corpus'

import { corpusMissing } from './context.ts'
import { createServer } from './server.ts'

/**
 * Контракт протокола: что клиент видит в списках инструментов, промптов и
 * ресурсов. Снят через настоящего клиента и сверяется с JSON рядом, поэтому
 * переживёт смену MCP SDK: любое расхождение -- это изменение поведения, которое
 * надо принять осознанно.
 *
 * Обновить фикстуру: `UPDATE_CONTRACT=1 npm test`, потом посмотреть diff.
 */
const FIXTURE = new URL('./contract.json', import.meta.url)

type Json = Record<string, unknown>

/** `$schema` дописывает конвертер zod, и `execution` -- сам SDK; клиенту они ничего не обещают. */
function tool({ name, title, description, inputSchema, outputSchema, annotations }: Json): Json {
	const schema = (s: unknown) => {
		if (!s) return undefined

		const { $schema: _, ...rest } = s as Json

		return rest
	}

	return {
		name,
		title,
		description,
		inputSchema: schema(inputSchema),
		outputSchema: schema(outputSchema),
		annotations,
	}
}

async function snapshot(client: Client): Promise<Json> {
	const [{ tools }, { prompts }, { resources }, { resourceTemplates }] = await Promise.all([
		client.listTools(),
		client.listPrompts(),
		client.listResources(),
		client.listResourceTemplates(),
	])

	return JSON.parse(
		JSON.stringify({
			server: {
				name: client.getServerVersion()?.name,
				capabilities: Object.keys(client.getServerCapabilities() ?? {}).sort(),
				instructions: client.getInstructions() ?? null,
			},
			tools: tools.map((t) => tool(t as Json)).sort((a, b) => String(a.name).localeCompare(String(b.name))),
			prompts,
			resources,
			resourceTemplates,
		}),
	) as Json
}

let seeded: Client
let empty: Client

before(async () => {
	seeded = await connectInMemory(createServer(seededConfig()))
	empty = await connectInMemory(createServer(emptyConfig()))
})

describe('контракт MCP', () => {
	it('списки инструментов, промптов и ресурсов совпадают с фикстурой', async () => {
		const actual = await snapshot(seeded)

		if (process.env.UPDATE_CONTRACT === '1') {
			writeFileSync(FIXTURE, `${JSON.stringify(actual, null, '\t')}\n`)
		}

		assert.deepEqual(actual, JSON.parse(readFileSync(FIXTURE, 'utf8')))
	})

	it('без корпуса сервер объявляет то же самое', async () => {
		assert.deepEqual(await snapshot(empty), await snapshot(seeded))
	})

	it('успешный ответ инструмента -- один текстовый блок без isError', async () => {
		const result = await seeded.callTool({ name: 'write_as_me', arguments: { brief: 'напиши, что задержусь' } })

		assert.notEqual(result.isError, true)
		assert.equal((result.content as unknown[]).length, 1)
		assert.equal((result.content as { type: string }[])[0]!.type, 'text')
		assert.match(textOf(result), /^# ЗАДАЧА\n\n.*: напиши, что задержусь\n/)
	})

	it('check_as_me вдобавок к тексту отдаёт структуру с оценкой и замечаниями', async () => {
		const result = await seeded.callTool({ name: 'check_as_me', arguments: { text: 'Буду через час.' } })
		const report = result.structuredContent as { score: unknown; findings: unknown }

		assert.notEqual(result.isError, true)
		assert.equal(typeof report.score, 'number')
		assert.ok(Array.isArray(report.findings))
		assert.match(textOf(result), /Оценка:/)
	})

	it('ошибка инструмента приходит результатом с isError и текстом для человека', async () => {
		for (const call of [
			{ name: 'write_as_me', arguments: { brief: 'x' } },
			{ name: 'reply_as_me', arguments: { incoming: 'x' } },
			{ name: 'rephrase_as_me', arguments: { text: 'x' } },
			{ name: 'check_as_me', arguments: { text: 'x' } },
			{ name: 'find_my_messages', arguments: { query: 'x' } },
		]) {
			const result = await empty.callTool(call)

			assert.equal(result.isError, true, call.name)
			assert.deepEqual(result.content, [{ type: 'text', text: corpusMissing('cli', false) }], call.name)
		}
	})

	// Сейчас SDK отдаёт ошибку валидации результатом с isError, а не ошибкой JSON-RPC.
	// Спецификация допускает и то и другое, но клиенту разница видна: менять только осознанно.
	it('неверные аргументы -- результат с isError, где названо поле', async () => {
		for (const [call, field] of [
			[{ name: 'write_as_me', arguments: {} }, 'brief'],
			[{ name: 'write_as_me', arguments: { brief: '' } }, 'brief'],
			[{ name: 'write_as_me' }, 'brief'],
			[{ name: 'find_my_messages', arguments: { query: 'x', register: 'tweets' } }, 'register'],
			[{ name: 'find_my_messages', arguments: { query: 'x', limit: 'много' } }, 'limit'],
			[{ name: 'check_as_me', arguments: { text: 42 } }, 'text'],
		] as const) {
			const result = await seeded.callTool(call as { name: string; arguments?: Record<string, unknown> })

			assert.equal(result.isError, true, JSON.stringify(call))
			assert.ok(textOf(result).includes(field), `${JSON.stringify(call)}: ${textOf(result)}`)
		}
	})

	it('лишние аргументы инструмент молча игнорирует', async () => {
		const result = await seeded.callTool({ name: 'write_as_me', arguments: { brief: 'x', mood: 'весёлый' } })

		assert.notEqual(result.isError, true)
	})

	it('неизвестный инструмент -- результат с isError и его именем', async () => {
		const result = await seeded.callTool({ name: 'no_such_tool', arguments: {} })

		assert.equal(result.isError, true)
		assert.match(textOf(result), /no_such_tool/)
	})

	it('неверный промпт или ресурс -- ошибка JSON-RPC -32602', async () => {
		for (const call of [
			seeded.getPrompt({ name: 'as-me', arguments: {} }),
			seeded.getPrompt({ name: 'no-such-prompt' }),
			seeded.readResource({ uri: 'style://nope' }),
		]) {
			await assert.rejects(call, { code: -32602 })
		}
	})
})
