import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { connectInMemory } from '@aimuzov/infra-mcp-kit/testing'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { emptyConfig, seededConfig } from '#thinks/testing/corpus'

import { createServer } from './server.ts'

let client: Client
let empty: Client

before(async () => {
	client = await connectInMemory(createServer(seededConfig()))
	empty = await connectInMemory(createServer(emptyConfig()))
})

/** Текст единственного сообщения промпта. */
async function promptText(c: Client, name: string, args?: Record<string, string>): Promise<string> {
	const { messages } = await c.getPrompt({ name, arguments: args })

	assert.equal(messages.length, 1)
	assert.equal(messages[0]!.role, 'user')
	assert.equal(messages[0]!.content.type, 'text')

	return (messages[0]!.content as { text: string }).text
}

describe('prompts', () => {
	it('перечисляет промпты с аргументами', async () => {
		const { prompts } = await client.listPrompts()
		const args = Object.fromEntries(
			prompts.map((p) => [p.name, (p.arguments ?? []).map((a) => `${a.name}${a.required ? '' : '?'}`)]),
		)

		assert.deepEqual(args, {
			'talk-like-me': [],
			'as-me': ['task'],
			'reply-as-me': ['incoming', 'hint?'],
			'comment-as-me': ['code', 'kind?'],
		})

		assert.ok(prompts.every((p) => p.title && p.description))
	})

	it('as-me передаёт задание в write_as_me и требует проверки', async () => {
		const text = await promptText(client, 'as-me', { task: 'поздравь Петра с днём рождения' })

		assert.ok(text.startsWith('Вызови write_as_me с этим заданием: поздравь Петра с днём рождения\n'))
		assert.match(text, /check_as_me/)
		assert.match(text, /ниже 85/)
	})

	it('reply-as-me добавляет смысл ответа, только когда он задан', async () => {
		const bare = await promptText(client, 'reply-as-me', { incoming: 'Ты где?' })
		const hinted = await promptText(client, 'reply-as-me', { incoming: 'Ты где?', hint: 'уже еду' })

		assert.ok(bare.startsWith('Вызови reply_as_me. Входящее сообщение: Ты где?\n\n'))
		assert.doesNotMatch(bare, /Смысл ответа/)
		assert.ok(hinted.startsWith('Вызови reply_as_me. Входящее сообщение: Ты где?\nСмысл ответа: уже еду\n\n'))
	})

	it('comment-as-me выбирает регистр по kind и требует передать код в проверку', async () => {
		const code = 'const RETRIES = 3'
		const inline = await promptText(client, 'comment-as-me', { code })
		const doc = await promptText(client, 'comment-as-me', { code, kind: 'jsdoc' })
		const other = await promptText(client, 'comment-as-me', { code, kind: 'python' })

		assert.ok(inline.includes('register: "code"'))
		assert.ok(!inline.includes('"jsdoc"'))
		assert.ok(doc.includes('write_as_me с register: "jsdoc"'))
		assert.ok(doc.includes('check_as_me с register: "jsdoc"'))
		assert.ok(other.includes('register: "code"'))
		assert.ok(inline.includes(`\n\n${code}\n\n`))
		assert.ok(inline.includes('`code`'))
	})

	it('talk-like-me отдаёт профиль, а без корпуса объясняет, как его собрать', async () => {
		assert.match(await promptText(client, 'talk-like-me'), /# Как я пишу/)

		const missing = await promptText(empty, 'talk-like-me')

		assert.match(missing, /Корпус не собран/)
		assert.match(missing, /thinks-mcp build/)
	})

	it('промпты с заданием не зависят от корпуса', async () => {
		assert.equal(await promptText(empty, 'as-me', { task: 'x' }), await promptText(client, 'as-me', { task: 'x' }))
	})

	it('отказывает без обязательного аргумента и на неизвестный промпт', async () => {
		await assert.rejects(client.getPrompt({ name: 'as-me', arguments: {} }), /task/)
		await assert.rejects(client.getPrompt({ name: 'reply-as-me', arguments: { hint: 'x' } }), /incoming/)
		await assert.rejects(client.getPrompt({ name: 'no-such-prompt' }), /no-such-prompt/)
	})
})
