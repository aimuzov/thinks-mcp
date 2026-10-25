import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { signTelegramLogin, sqliteStore, Tokens } from '@aimuzov/infra-mcp-kit/http'
import { connectHttp, oauthFlow, startHttp, textOf, type RunningHttp } from '@aimuzov/infra-mcp-kit/testing'

import { buildCorpus } from '#thinks/corpus/build'
import { makeDump } from '#thinks/testing/fixtures'

import { createApp } from './app.ts'
import { migrateAuthDb } from './auth-db.ts'
import { Builds, type BuildRunner } from './builds.ts'
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

function config(publicUrl: string): ThinksHttpConfig {
	return {
		http: { port: 0, publicUrl: new URL(publicUrl), authSecret: SECRET, allowedRedirectUris: [] },
		telegramBotToken: BOT_TOKEN,
		telegramBotName: 'thinks_test_bot',
		dataDir,
		maxUploadBytes: 1024 * 1024,
		buildHeapMb: 256,
		devUserId: '',
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

/** What the widget does: append the signed login to the auth URL and follow it. */
function widget(id: string, botToken = BOT_TOKEN) {
	return (_page: string, callback: URL) => {
		for (const [k, v] of Object.entries(telegram(id, botToken))) callback.searchParams.set(k, v)

		return fetch(callback, { redirect: 'manual' })
	}
}

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

		assert.ok(textOf(await stranger.callTool(brief)).includes('Корпус не собран'))
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

	it('greets a logged-in user on the kit page with the page script', async () => {
		const cookie = await sessionCookie(OWNER)
		const page = await (await fetch(`${http.base}/account`, { headers: { cookie } })).text()

		assert.match(page, /Привет, Ivan/)
		assert.match(page, /<script src="\/account\.js" defer>/)
		assert.equal((await fetch(`${http.base}/account.js`)).status, 200)
	})

	it('keeps the session cookie of the old server', async () => {
		const before = new Tokens({ secret: SECRET, issuer: new URL(http.base).href })
		const cookie = `thinks_session=${await before.sign('session', { sub: OWNER, name: 'Ivan' })}`
		const page = await (await fetch(`${http.base}/account`, { headers: { cookie } })).text()

		assert.match(page, /Привет, Ivan/)
	})

	it('builds a corpus from the uploaded export and deletes the export', async () => {
		const cookie = await sessionCookie(OWNER)

		assert.equal((await upload(cookie, JSON.stringify(makeDump()))).status, 202)
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
		assert.equal((await deleteAccount(cookie)).status, 302)
		release()
		await builds.idle()
		assert.equal(existsSync(users.dir(OWNER)), false)
	})

	it('deletes everything the user has', async () => {
		seedCorpus(OWNER)

		const cookie = await sessionCookie(OWNER)
		const res = await fetch(`${http.base}/account/delete`, {
			method: 'POST',
			headers: { cookie, origin: http.base },
			redirect: 'manual',
		})

		assert.equal(res.status, 302)
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

	it('saves the switch from the account form', async () => {
		const url = new URL('/account/login', http.base)

		for (const [k, v] of Object.entries(telegram(OWNER))) url.searchParams.set(k, v)

		const login = await fetch(url, { redirect: 'manual' })
		const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
		const save = (body: string) =>
			fetch(`${http.base}/account/settings`, {
				method: 'POST',
				headers: { cookie, origin: http.base, 'content-type': 'application/x-www-form-urlencoded' },
				body,
				redirect: 'manual',
			})

		await save('neverMarks=&chatStopList=&recentYears=3&voice=1')
		assert.equal(users.settings(OWNER).voice, true)
		// An unchecked box is simply absent from the form.
		await save('neverMarks=&chatStopList=&recentYears=3')
		assert.equal(users.settings(OWNER).voice, false)
	})
})
