import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it, mock } from 'node:test'
import { sqliteStore } from '@aimuzov/infra-mcp-kit/http'
import { connectHttp, fakePages, startHttp, type RunningHttp } from '@aimuzov/infra-mcp-kit/testing'

import { createApp } from './app.ts'
import { migrateAuthDb } from './auth-db.ts'
import { Builds, type BuildRunner } from './builds.ts'
import type { ThinksHttpConfig } from './config.ts'
import { Users } from './users.ts'

// auth.db и токены выпустил кит 2.1.0, на котором thinks жил до 3.0. thinks подписывает
// токены (режим sign): живые подключения должны пережить выкатку без нового входа.
const fixtures = join(import.meta.dirname, '../testing/fixtures')
const fixture = JSON.parse(readFileSync(join(fixtures, 'tokens-2.1.json'), 'utf8')) as {
	secret: string
	issuer: string
	createdAt: number
	modes: { sign: { clientId: string; access_token: string; refresh_token: string } }
}
const issued = fixture.modes.sign
let running: RunningHttp | undefined

after(async () => {
	await running?.close()
	mock.timers.reset()
})

/** В фикстуре кита subject `user-sign`, а у thinks id -- число из Telegram. */
function usersFor(dataDir: string): Users {
	const users = new Users(dataDir)
	const id = (userId: string) => (userId === 'user-sign' ? '42' : userId)

	return new Proxy(users, {
		get(target, key, receiver) {
			const value = Reflect.get(target, key, receiver)

			return typeof value === 'function'
				? (userId: unknown, ...rest: unknown[]) =>
						value.call(target, typeof userId === 'string' ? id(userId) : userId, ...rest)
				: value
		},
	})
}

it('auth.db и токены кита 2.1 работают на 3.0: доступ, refresh и отказ повтору', async () => {
	// Токены выпущены в момент createdAt: часы ставим на минуту позже, пока access ещё жив.
	// Подменяем весь Date, а не Date.now: jose сверяет срок по `new Date()`.
	mock.timers.enable({ apis: ['Date'], now: fixture.createdAt + 60_000 })

	const dataDir = mkdtempSync(join(tmpdir(), 'thinks-compat-'))
	const db = join(dataDir, 'auth.db')

	copyFileSync(join(fixtures, 'auth-2.1.db'), db)
	migrateAuthDb(db)

	const users = usersFor(dataDir)
	const idle: BuildRunner = async () => null
	const cfg: ThinksHttpConfig = {
		http: { port: 0, publicUrl: new URL(fixture.issuer), authSecret: fixture.secret, allowedRedirectUris: [] },
		telegramBotToken: 'bot',
		telegramBotName: 'thinks_test_bot',
		dataDir,
		maxUploadBytes: 1024,
		buildHeapMb: 256,
		devUserId: '',
	}

	running = await startHttp(() =>
		createApp({
			cfg,
			store: sqliteStore(db),
			users,
			builds: new Builds(users, dataDir, idle),
			publicDir: fakePages(),
		}),
	)

	const client = await connectHttp(running.base, issued.access_token)

	assert.ok((await client.listTools()).tools.length > 0, 'старый access-токен пускает к инструментам')
	await client.close()

	const refresh = (token: string) =>
		fetch(`${running!.base}/token`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: token,
				client_id: issued.clientId,
			}),
		})

	assert.equal((await refresh(issued.refresh_token)).status, 200, 'старый refresh-токен меняется на новую пару')
	assert.equal((await refresh(issued.refresh_token)).status, 400, 'потраченный refresh второй раз не работает')
})
