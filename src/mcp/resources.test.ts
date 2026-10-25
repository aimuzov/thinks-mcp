import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { connectInMemory } from '@aimuzov/infra-mcp-kit/testing'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { emptyConfig, seededConfig } from '#thinks/testing/corpus'

import { createServer } from './server.ts'

let client: Client
let empty: Client

before(async () => {
	client = await connectInMemory(createServer(seededConfig({ code: true })))
	empty = await connectInMemory(createServer(emptyConfig()))
})

async function read(c: Client, uri: string) {
	const { contents } = await c.readResource({ uri })

	assert.equal(contents.length, 1)
	assert.equal(contents[0]!.uri, uri)
	assert.equal(contents[0]!.mimeType, 'text/markdown')

	return String((contents[0] as { text?: string }).text)
}

describe('resources', () => {
	it('перечисляет общий профиль и профиль каждого регистра', async () => {
		const { resources } = await client.listResources()

		assert.deepEqual(
			resources.map((r) => [r.uri, r.name]),
			[
				['style://profile', 'style-profile'],
				['style://profile/dm', 'style-profile-dm'],
				['style://profile/group', 'style-profile-group'],
				['style://profile/longform', 'style-profile-longform'],
				['style://profile/code', 'style-profile-code'],
				['style://profile/jsdoc', 'style-profile-jsdoc'],
			],
		)

		assert.ok(resources.every((r) => r.mimeType === 'text/markdown'))
	})

	it('объявляет шаблон профиля по регистру', async () => {
		const { resourceTemplates } = await client.listResourceTemplates()

		assert.deepEqual(
			resourceTemplates.map((t) => [t.name, t.uriTemplate, t.mimeType]),
			[['style-profile-register', 'style://profile/{register}', 'text/markdown']],
		)
	})

	it('style://profile -- это профиль личной переписки', async () => {
		assert.equal(await read(client, 'style://profile'), await read(client, 'style://profile/dm'))
	})

	it('отдаёт полный профиль своего регистра', async () => {
		const dm = await read(client, 'style://profile/dm')
		const group = await read(client, 'style://profile/group')
		const code = await read(client, 'style://profile/code')
		const jsdoc = await read(client, 'style://profile/jsdoc')

		assert.match(dm, /^# Как я пишу/)
		assert.notEqual(dm, group)
		assert.match(code, /^# Как я комментирую код -- инлайн/)
		assert.match(jsdoc, /^# Как я комментирую код -- JSDoc/)
	})

	it('на неизвестный регистр отдаёт личную переписку под запрошенным адресом', async () => {
		assert.equal(await read(client, 'style://profile/tweets'), await read(client, 'style://profile/dm'))
	})

	it('без корпуса объясняет, как его собрать', async () => {
		for (const uri of ['style://profile', 'style://profile/code']) {
			assert.match(await read(empty, uri), /thinks-mcp build/)
		}
	})

	it('отказывает на чужой адрес', async () => {
		await assert.rejects(client.readResource({ uri: 'style://nope' }), /style:\/\/nope/)
	})
})
