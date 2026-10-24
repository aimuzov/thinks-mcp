import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { signTelegramLogin, verifyTelegramLogin } from './telegram.ts'

const TOKEN = '123:bot'
const now = 1_700_000_000_000
const fields = { id: '42', first_name: 'Ivan', auth_date: String(now / 1000) }

describe('verifyTelegramLogin', () => {
	it('accepts a fresh login signed with the bot token', () => {
		const login = verifyTelegramLogin(signTelegramLogin(fields, TOKEN), TOKEN, now)
		assert.deepEqual(login, { id: '42', firstName: 'Ivan', username: '' })
	})

	it('ignores parameters the widget did not sign', () => {
		const query = { ...signTelegramLogin(fields, TOKEN), request: 'anything' }
		assert.equal(verifyTelegramLogin(query, TOKEN, now)?.id, '42')
	})

	it('refuses a changed field', () => {
		const query = { ...signTelegramLogin(fields, TOKEN), id: '43' }
		assert.equal(verifyTelegramLogin(query, TOKEN, now), null)
	})

	it('refuses another bot', () => {
		const query = signTelegramLogin(fields, '999:other')
		assert.equal(verifyTelegramLogin(query, TOKEN, now), null)
	})

	it('refuses a stale login', () => {
		const query = signTelegramLogin(fields, TOKEN)
		assert.equal(verifyTelegramLogin(query, TOKEN, now + 11 * 60 * 1000), null)
	})
})
