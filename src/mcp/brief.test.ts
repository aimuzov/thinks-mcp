import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { connectInMemory, textOf } from '@aimuzov/infra-mcp-kit/testing'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { seededConfig } from '#thinks/testing/corpus'

import { renderBrief } from './brief.ts'
import { CorpusRef } from './context.ts'
import { createServer } from './server.ts'

let client: Client

before(async () => {
	client = await connectInMemory(createServer(seededConfig({ code: true })))
})

const write = async (register: string, brief: string) =>
	textOf(await client.callTool({ name: 'write_as_me', arguments: { brief, register } }))

/** Раздел брифа от заголовка до следующего. */
const section = (text: string, title: string) => text.split(`# ${title}\n`)[1]?.split('\n\n# ')[0] ?? ''

describe('бриф', () => {
	it('показывает комментарий вместе с кодом под ним', async () => {
		const text = await write('code', 'объясни, зачем повторять запрос к серверу')
		const examples = section(text, 'ПРИМЕРЫ ИЗ АРХИВА')

		assert.match(examples, /^\[1\] инлайн-комментарий, repo-\S+ \d{4}$/m)
		assert.match(examples, /^ {2}Комментарий:\n {4}\S/m)
		assert.match(examples, /^ {2}Над кодом: const /m)
		// Название репозитория выдаёт работодателя, в бриф оно не попадает.
		assert.doesNotMatch(text, /secret-employer/)
		assert.doesNotMatch(examples, /Я ответил:/)
	})

	it('для инлайн-комментария требует маркер комментария в каждой строке', async () => {
		const contract = section(await write('code', 'объясни таймаут'), 'ФОРМАТ ОТВЕТА')

		assert.match(contract, /Выведи только текст комментария/)
		assert.match(contract, /ведущим маркером комментария/)
		assert.match(contract, /не выдумывай/)
	})

	it('для JSDoc требует готовый докблок', async () => {
		const contract = section(await write('jsdoc', 'опиши waitForService'), 'ФОРМАТ ОТВЕТА')

		assert.match(contract, /`\/\*\*` и `\*\/`/)
		assert.doesNotMatch(contract, /ведущим маркером/)
	})

	it('для длинного текста запрещает заголовки и списки, которых нет в примерах', async () => {
		const contract = section(await write('longform', 'расскажи про сантехника'), 'ФОРМАТ ОТВЕТА')

		assert.match(contract, /Выведи только готовый текст/)
		assert.match(contract, /Не добавляй заголовков и списков/)
	})

	it('для переписки просит по сообщению на строку', async () => {
		const contract = section(await write('dm', 'напиши, что задержусь'), 'ФОРМАТ ОТВЕТА')

		assert.match(contract, /Одно сообщение -- одна строка/)
		assert.match(contract, /Не нумеруй сообщения/)
	})

	it('отличает процитированный ответ от угаданного по порядку', async () => {
		const text = textOf(
			await client.callTool({ name: 'reply_as_me', arguments: { incoming: 'А что с доставкой?' } }),
		)

		assert.ok(text.includes('Мне написали (я ответил именно на это): А что с доставкой?'))
	})
})

describe('renderBrief', () => {
	it('без примеров и ограничений оставляет только задачу, профиль и формат', async () => {
		const corpus = new CorpusRef(seededConfig()).get()!
		const text = renderBrief({
			task: 'Задача.',
			register: 'dm',
			profile: { ...corpus.profile, registers: {} },
			examples: [],
			outputContract: 'Только да или нет.',
		})

		assert.ok(text.startsWith('# ЗАДАЧА\n\nЗадача.\n\n'))
		assert.doesNotMatch(text, /# ПРИМЕРЫ ИЗ АРХИВА/)
		assert.ok(text.endsWith('# ФОРМАТ ОТВЕТА\n\nТолько да или нет.'))
	})
})
