import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { signTelegramLogin, sqliteStore, Tokens } from '@aimuzov/infra-mcp-kit/http'
import {
	connectHttp,
	devLink,
	fakePages,
	oauthFlow,
	startHttp,
	telegramSigned,
	textOf,
	type RunningHttp,
} from '@aimuzov/infra-mcp-kit/testing'
import express from 'express'

import { buildCorpus } from '#thinks/corpus/build'
import { makeDump } from '#thinks/testing/fixtures'

import { createApp, listen, type AccountState } from './app.ts'
import { migrateAuthDb } from './auth-db.ts'
import { BUILD_STEPS, Builds, type BuildRunner } from './builds.ts'
import type { ThinksHttpConfig } from './config.ts'
import { Users } from './users.ts'

const BOT_TOKEN = '123:test-bot-token'
const SECRET = 'x'.repeat(32)
// The fixture dump belongs to user1 and talks to user2.
const OWNER = '1'
const STRANGER = '2'

/** Builds in-process: the child-process runner is covered by the build worker itself. */
const inProcess =
	(users: Users): BuildRunner =>
	async (job) => {
		await gate

		try {
			buildCorpus({ ...users.config(job.userId), ...job }, () => {}, { expectOwnerId: `user${job.userId}` })

			return null
		} catch (err) {
			return (err as Error).message
		}
	}

/** Builds wait on this while a test holds them; see hold(). */
let gate: Promise<void> = Promise.resolve()

/** Keep builds from finishing until the returned function is called. */
function hold(): () => void {
	let release!: () => void

	gate = new Promise((r) => (release = r))

	return release
}

let dataDir: string
let http: RunningHttp
let users: Users
let builds: Builds

function config(publicUrl: string, devUserId = ''): ThinksHttpConfig {
	return {
		http: { port: 0, publicUrl: new URL(publicUrl), authSecret: SECRET, allowedRedirectUris: [] },
		telegramBotToken: BOT_TOKEN,
		telegramBotName: 'thinks_test_bot',
		dataDir,
		maxUploadBytes: 1024 * 1024,
		buildHeapMb: 256,
		devUserId,
	}
}

beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'thinks-http-'))
	users = new Users(dataDir)
	builds = new Builds(users, dataDir, inProcess(users))

	http = await startHttp((base) =>
		createApp({ cfg: config(base), store: sqliteStore(join(dataDir, 'auth.db')), users, builds }),
	)
})

afterEach(() => http.close())

function telegram(id: string, botToken = BOT_TOKEN) {
	return signTelegramLogin({ id, first_name: 'Ivan', auth_date: String(Math.floor(Date.now() / 1000)) }, botToken)
}

/** What the widget does on the static login page: come back to the callback with a signed query. */
const widget = (id: string, botToken = BOT_TOKEN) => telegramSigned({ id, first_name: 'Ivan' }, botToken)

async function connect(userId: string) {
	const { tokens } = await oauthFlow({ base: http.base, login: widget(userId) })

	return connectHttp(http.base, tokens.access_token)
}

function seedCorpus(userId: string) {
	const dir = users.dir(userId)

	mkdirSync(dir, { recursive: true })

	const dumpPath = join(dir, 'seed.json')

	writeFileSync(dumpPath, JSON.stringify(makeDump()))
	buildCorpus({ ...users.config(userId), dumpPath })
}

const brief = { name: 'write_as_me', arguments: { brief: 'напиши, что задержусь' } }

describe('OAuth', () => {
	it('issues tokens for a Telegram login, and a code works once', async () => {
		const flow = await oauthFlow({ base: http.base, login: widget(OWNER) })

		assert.ok(flow.tokens.access_token)
		assert.equal((await flow.exchangeAgain()).status, 400)
	})

	it('пускает по dev-ссылке на localhost, когда задан THINKS_DEV_USER_ID', async () => {
		const dev = await startHttp((base) =>
			createApp({
				cfg: config(base, OWNER),
				store: sqliteStore(join(dataDir, 'dev-auth.db')),
				users,
				builds,
				publicDir: fakePages(),
			}),
		)

		try {
			seedCorpus(OWNER)

			const { tokens } = await oauthFlow({ base: dev.base, login: devLink() })
			const client = await connectHttp(dev.base, tokens.access_token)

			assert.ok(textOf(await client.callTool(brief)).includes('# ПРИМЕРЫ ИЗ АРХИВА'))
		} finally {
			await dev.close()
		}
	})

	it('refuses a login signed with another bot token', async () => {
		await assert.rejects(oauthFlow({ base: http.base, login: widget(OWNER, '999:forged') }))
	})

	it('keeps tokens issued before the kit valid', async () => {
		// The old server signed the same claims with the same key and issuer.
		const before = new Tokens({ secret: SECRET, issuer: new URL(http.base).href })
		const token = await before.sign('access', { sub: OWNER, client_id: 'old-client' })

		seedCorpus(OWNER)

		const client = await connectHttp(http.base, token)

		assert.ok(textOf(await client.callTool(brief)).includes('# ПРИМЕРЫ ИЗ АРХИВА'))
	})
})

describe('auth.db written before the kit', () => {
	it('keeps registered clients and drops the old pending codes', () => {
		const path = join(dataDir, 'old-auth.db')
		const db = new DatabaseSync(path)

		db.prepare('CREATE TABLE client (client_id TEXT PRIMARY KEY, info TEXT NOT NULL)').run()

		db.prepare(
			`CREATE TABLE auth_code (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_id TEXT NOT NULL,
				challenge TEXT NOT NULL, redirect TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
		).run()

		db.prepare('INSERT INTO client VALUES (?, ?)').run('c1', JSON.stringify({ client_id: 'c1', redirect_uris: [] }))
		db.close()

		migrateAuthDb(path)

		const store = sqliteStore(path)

		assert.equal(store.getClient('c1')?.client_id, 'c1')

		const code = store.issueCode({
			clientId: 'c1',
			codeChallenge: 'x',
			redirectUri: 'http://127.0.0.1/cb',
			grant: 'g',
		})

		assert.equal(store.takeCode(code)?.grant, 'g')
		store.close?.()
	})
})

describe('MCP over HTTP', () => {
	it("serves each user their own corpus and nobody else's", async () => {
		seedCorpus(OWNER)

		const owner = await connect(OWNER)

		assert.ok(textOf(await owner.callTool(brief)).includes('# ПРИМЕРЫ ИЗ АРХИВА'))

		const stranger = await connect(STRANGER)

		assert.ok(textOf(await stranger.callTool(brief)).includes('загрузи result.json в кабинете'))
	})
})

describe('account', () => {
	async function sessionCookie(userId: string) {
		const url = new URL('/account/login', http.base)

		for (const [k, v] of Object.entries(telegram(userId))) url.searchParams.set(k, v)

		const res = await fetch(url, { redirect: 'manual' })

		assert.equal(res.status, 302)

		return res.headers.get('set-cookie')?.split(';')[0] ?? ''
	}

	const deleteAccount = (cookie: string) =>
		fetch(`${http.base}/account/delete`, {
			method: 'POST',
			headers: { cookie, origin: http.base },
			redirect: 'manual',
		})

	/** A body without content-length, fed by `feed` as the test sees fit. */
	const streamUpload = (cookie: string, feed: (push: ReadableStreamDefaultController<Uint8Array>) => void) =>
		fetch(`${http.base}/account/upload`, {
			method: 'PUT',
			headers: { cookie, origin: http.base, 'content-type': 'application/octet-stream' },
			body: new ReadableStream<Uint8Array>({ start: feed }),
			duplex: 'half',
		} as RequestInit)

	const upload = (cookie: string, body: string, origin = http.base) =>
		fetch(`${http.base}/account/upload`, {
			method: 'PUT',
			headers: { cookie, origin, 'content-type': 'application/octet-stream' },
			body,
		})

	const accountState = async (cookie: string) => {
		const res = await fetch(`${http.base}/account/state`, { headers: { cookie } })

		assert.equal(res.status, 200)

		return (await res.json()) as AccountState
	}

	it('отдаёт состояние кабинета вошедшему и 401 всем остальным', async () => {
		const unauthorized = await fetch(`${http.base}/account/state`)

		assert.equal(unauthorized.status, 401)
		assert.equal(((await unauthorized.json()) as { error: { code: string } }).error.code, 'unauthorized')

		const state = await accountState(await sessionCookie(OWNER))

		assert.equal(state.name, 'Ivan')
		assert.equal(state.hasCorpus, false)
		assert.equal(state.status, null)
		assert.equal(state.busy, false)
		assert.equal(state.settings.recentYears, 3)
	})

	it('keeps the session cookie of the old server', async () => {
		const before = new Tokens({ secret: SECRET, issuer: new URL(http.base).href })
		const cookie = `thinks_session=${await before.sign('session', { sub: OWNER, name: 'Ivan' })}`

		assert.equal((await accountState(cookie)).name, 'Ivan')
	})

	it('отправляет на страницу ошибки, когда Telegram не подтвердил вход', async () => {
		const url = new URL('/account/login', http.base)

		for (const [k, v] of Object.entries(telegram(OWNER, '999:forged'))) url.searchParams.set(k, v)

		const res = await fetch(url, { redirect: 'manual' })

		assert.equal(res.status, 302)
		assert.match(res.headers.get('location') ?? '', /^\/error\?code=login&/)
		assert.equal(res.headers.get('set-cookie'), null)
	})

	it('подсказывает странице входа бота и выключает dev-вход вне localhost', async () => {
		const res = await fetch(`${http.base}/account/auth`)

		assert.deepEqual(await res.json(), { botName: 'thinks_test_bot', dev: null })
	})

	it('выходит из кабинета только со страницы сервиса', async () => {
		const cookie = await sessionCookie(OWNER)
		const logout = (origin: string) =>
			fetch(`${http.base}/account/logout`, { method: 'POST', headers: { cookie, origin } })

		assert.equal((await logout('https://evil.example')).status, 403)

		const res = await logout(http.base)

		assert.equal(res.status, 200)
		assert.match(res.headers.get('set-cookie') ?? '', /^thinks_session=;/)
	})

	it('пишет шаги сборки в статус, пока она идёт', async () => {
		const seen: Array<number | undefined> = []
		const watching = new Builds(users, dataDir, async (job, progress) => {
			for (let i = 0; i < BUILD_STEPS.length; i++) {
				progress()
				seen.push(watching.status(job.userId)?.step)
			}

			writeFileSync(job.dbPath, '')

			return null
		})

		mkdirSync(users.dir(OWNER), { recursive: true })
		writeFileSync(watching.dumpPath(OWNER), '{}')
		watching.enqueue(OWNER)
		await watching.idle()

		assert.deepEqual(seen, [1, 2, 3, 4, 5])
		assert.equal(watching.status(OWNER)?.state, 'ready')
		assert.equal(watching.status(OWNER)?.step, undefined)
	})

	it('builds a corpus from the uploaded export and deletes the export', async () => {
		const cookie = await sessionCookie(OWNER)

		const res = await upload(cookie, JSON.stringify(makeDump()))

		assert.equal(res.status, 202)
		// Очередь пуста, и сборка берётся сразу: кабинет видит её уже идущей.
		assert.equal(((await res.json()) as AccountState).status?.state, 'building')
		await builds.idle()

		assert.equal(builds.status(OWNER)?.state, 'ready')
		assert.equal(users.hasCorpus(OWNER), true)
		assert.equal(existsSync(builds.dumpPath(OWNER)), false)
	})

	it("refuses someone else's export", async () => {
		const cookie = await sessionCookie(STRANGER)

		await upload(cookie, JSON.stringify(makeDump()))
		await builds.idle()

		assert.equal(builds.status(STRANGER)?.state, 'failed')
		assert.equal(users.hasCorpus(STRANGER), false)
	})

	it('refuses uploads from another origin', async () => {
		const cookie = await sessionCookie(OWNER)

		assert.equal((await upload(cookie, '{}', 'https://evil.example')).status, 403)
	})

	it('отвечает 500, а не 413, когда файл не записать', async () => {
		const cookie = await sessionCookie(OWNER)

		// Каталог только на чтение: запись падает с EACCES, как упала бы с ENOSPC.
		mkdirSync(users.dir(OWNER), { recursive: true })
		chmodSync(users.dir(OWNER), 0o500)

		try {
			assert.equal((await upload(cookie, JSON.stringify(makeDump()))).status, 500)
		} finally {
			chmodSync(users.dir(OWNER), 0o700)
		}
	})

	it('отвечает 413 на файл больше лимита без content-length', async () => {
		const cookie = await sessionCookie(OWNER)
		const res = await streamUpload(cookie, (push) => {
			push.enqueue(new Uint8Array(2 * 1024 * 1024))
			push.close()
		})

		assert.equal(res.status, 413)
	})

	it('не пускает вторую загрузку, пока идёт первая', async () => {
		const cookie = await sessionCookie(OWNER)
		let push!: ReadableStreamDefaultController<Uint8Array>
		const first = streamUpload(cookie, (c) => {
			push = c
			c.enqueue(new TextEncoder().encode(JSON.stringify(makeDump())))
		})

		while (!existsSync(builds.dumpPath(OWNER))) await new Promise((r) => setTimeout(r, 5))

		assert.equal((await upload(cookie, '{}')).status, 409)
		push.close()
		assert.equal((await first).status, 202)
		await builds.idle()
		assert.equal(builds.status(OWNER)?.state, 'ready')
	})

	it('не удаляет аккаунт посреди сборки', async () => {
		const cookie = await sessionCookie(OWNER)
		const release = hold()

		await upload(cookie, JSON.stringify(makeDump()))

		assert.equal((await deleteAccount(cookie)).status, 409)
		release()
		await builds.idle()
		assert.equal(users.hasCorpus(OWNER), true)
	})

	it('снимает сборку из очереди, когда аккаунт удаляют', async () => {
		const release = hold()

		await upload(await sessionCookie(STRANGER), JSON.stringify(makeDump()))

		const cookie = await sessionCookie(OWNER)

		await upload(cookie, JSON.stringify(makeDump()))
		assert.equal(builds.status(OWNER)?.state, 'queued')
		assert.equal((await deleteAccount(cookie)).status, 200)
		release()
		await builds.idle()
		assert.equal(existsSync(users.dir(OWNER)), false)
	})

	it('deletes everything the user has', async () => {
		seedCorpus(OWNER)

		const res = await deleteAccount(await sessionCookie(OWNER))

		assert.equal(res.status, 200)
		assert.match(res.headers.get('set-cookie') ?? '', /^thinks_session=;/)
		assert.equal(users.hasCorpus(OWNER), false)
	})
})

describe('voice mode', () => {
	it('sends the profile as instructions only while the switch is on', async () => {
		seedCorpus(OWNER)

		const { tokens } = await oauthFlow({ base: http.base, login: widget(OWNER) })

		assert.equal((await connectHttp(http.base, tokens.access_token)).getInstructions(), undefined)

		users.saveSettings(OWNER, { ...users.settings(OWNER), voice: true })

		const instructions = (await connectHttp(http.base, tokens.access_token)).getInstructions() ?? ''

		assert.ok(instructions.includes('его же голосом'))
		assert.ok(instructions.includes('# Как я пишу'))
	})

	it('offers the same text as a prompt for clients that drop instructions', async () => {
		seedCorpus(OWNER)

		const client = await connect(OWNER)
		const prompt = await client.getPrompt({ name: 'talk-like-me' })
		const text = String((prompt.messages[0]?.content as { text?: string } | undefined)?.text)

		assert.ok(text.includes('# Как я пишу'))
	})

	it('saves the switch from the account settings', async () => {
		const url = new URL('/account/login', http.base)

		for (const [k, v] of Object.entries(telegram(OWNER))) url.searchParams.set(k, v)

		const login = await fetch(url, { redirect: 'manual' })
		const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
		const save = (body: Record<string, unknown>) =>
			fetch(`${http.base}/account/settings`, {
				method: 'POST',
				headers: { cookie, origin: http.base, 'content-type': 'application/json' },
				body: JSON.stringify(body),
			})
		const saved = await save({ neverMarks: '—:--', chatStopList: '', recentYears: 99, voice: true })

		assert.equal(saved.status, 200)
		assert.equal(((await saved.json()) as AccountState).settings.voice, true)
		assert.equal(users.settings(OWNER).voice, true)
		// Годы вне 1..20 сбрасываются на значение по умолчанию, а строка не становится голосом.
		assert.equal(users.settings(OWNER).recentYears, 3)
		await save({ neverMarks: '', chatStopList: '', recentYears: 5, voice: '1' })
		assert.equal(users.settings(OWNER).voice, false)
		assert.equal(users.settings(OWNER).recentYears, 5)

		// Форма из вкладки, открытой до деплоя, шлёт urlencoded. Пустым телом она
		// сбросила бы настройки к умолчаниям, поэтому сервер её отклоняет.
		const stale = await fetch(`${http.base}/account/settings`, {
			method: 'POST',
			headers: { cookie, origin: http.base, 'content-type': 'application/x-www-form-urlencoded' },
			body: 'neverMarks=&chatStopList=&recentYears=3',
		})

		assert.equal(stale.status, 415)
		assert.equal(users.settings(OWNER).recentYears, 5)
	})
})

describe('listen', () => {
	it('отклоняет промис, когда порт занят', async () => {
		const busy = createServer()

		await new Promise<void>((r) => busy.listen(0, r))

		const { port } = busy.address() as AddressInfo

		try {
			await assert.rejects(listen(express(), port), { code: 'EADDRINUSE' })
		} finally {
			busy.close()
		}
	})
})
