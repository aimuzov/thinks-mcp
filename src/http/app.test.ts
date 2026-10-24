import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { buildCorpus } from '#thinks/corpus/build'
import { makeDump } from '#thinks/testing/fixtures'

import { createApp } from './app.ts'
import { AuthStore } from './auth/store.ts'
import { signTelegramLogin } from './auth/telegram.ts'
import { Tokens } from './auth/tokens.ts'
import { Builds, type BuildRunner } from './builds.ts'
import type { HttpConfig } from './config.ts'
import { Users } from './users.ts'

const BOT_TOKEN = '123:test-bot-token'
// The fixture dump belongs to user1 and talks to user2.
const OWNER = '1'
const STRANGER = '2'
const REDIRECT = 'http://127.0.0.1:33418/callback'

/** Builds in-process: the child-process runner needs the compiled worker. */
const inProcess =
	(users: Users): BuildRunner =>
	async (job) => {
		try {
			const cfg = { ...users.config(job.userId), ...job }
			buildCorpus(cfg, () => {}, { expectOwnerId: `user${job.userId}` })
			return null
		} catch (err) {
			return (err as Error).message
		}
	}

let dataDir: string
let base: string
let server: Server
let users: Users
let builds: Builds

function config(publicUrl: string): HttpConfig {
	return {
		port: 0,
		publicUrl: new URL(publicUrl),
		authSecret: 'x'.repeat(32),
		telegramBotToken: BOT_TOKEN,
		telegramBotName: 'thinks_test_bot',
		allowedRedirectUris: ['https://claude.ai/api/mcp/auth_callback'],
		dataDir,
		maxUploadBytes: 1024 * 1024,
		devUserId: '',
	}
}

beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'thinks-http-'))
	users = new Users(dataDir)
	builds = new Builds(users, dataDir, inProcess(users))

	// Listen first: the app needs its public URL, and the port is known only now.
	server = createHttpServer()
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	server.on(
		'request',
		createApp({
			cfg: config(base),
			store: new AuthStore(join(dataDir, 'auth.db')),
			users,
			builds,
			tokens: new Tokens('x'.repeat(32), base),
		}),
	)
})

afterEach(() => {
	server.closeAllConnections()
	server.close()
})

function telegram(id: string, botToken = BOT_TOKEN) {
	return signTelegramLogin(
		{
			id,
			first_name: 'Ivan',
			auth_date: String(Math.floor(Date.now() / 1000)),
		},
		botToken,
	)
}

function register(redirect = REDIRECT) {
	return fetch(`${base}/register`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			client_name: 'test',
			redirect_uris: [redirect],
			token_endpoint_auth_method: 'none',
		}),
	})
}

/** The whole OAuth dance for a Telegram user. */
async function authorize(userId: string, botToken = BOT_TOKEN) {
	const { client_id } = (await (await register()).json()) as {
		client_id: string
	}
	const verifier = randomBytes(32).toString('base64url')
	const challenge = createHash('sha256').update(verifier).digest('base64url')

	const page = await fetch(
		`${base}/authorize?` +
			new URLSearchParams({
				response_type: 'code',
				client_id,
				redirect_uri: REDIRECT,
				code_challenge: challenge,
				code_challenge_method: 'S256',
				state: 'st',
			}),
	).then((r) => r.text())
	const authUrl = page.match(/data-auth-url="([^"]+)"/)![1]!.replace(/&amp;/g, '&')

	// What the widget does: append the signed login to the auth URL.
	const callback = new URL(authUrl)
	for (const [k, v] of Object.entries(telegram(userId, botToken))) {
		callback.searchParams.set(k, v)
	}
	const redirect = await fetch(callback, { redirect: 'manual' })
	if (redirect.status !== 302) return { status: redirect.status }
	const location = new URL(redirect.headers.get('location')!)
	assert.equal(location.searchParams.get('state'), 'st')
	const code = location.searchParams.get('code')!

	const exchange = () =>
		fetch(`${base}/token`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				code_verifier: verifier,
				client_id,
				redirect_uri: REDIRECT,
			}),
		})
	const first = await exchange()
	const second = await exchange()
	return {
		status: first.status,
		reuseStatus: second.status,
		tokens: (await first.json()) as {
			access_token: string
			refresh_token: string
		},
	}
}

async function mcpClient(accessToken: string) {
	const client = new Client({ name: 'test', version: '0.0.0' })
	await client.connect(
		new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
			requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
		}),
	)
	return client
}

function seedCorpus(userId: string) {
	const dir = users.dir(userId)
	mkdirSync(dir, { recursive: true })
	const dumpPath = join(dir, 'seed.json')
	writeFileSync(dumpPath, JSON.stringify(makeDump()))
	buildCorpus({ ...users.config(userId), dumpPath })
}

const textOf = (result: unknown): string =>
	((result as { content: { type: string; text: string }[] }).content ?? [])
		.filter((c) => c.type === 'text')
		.map((c) => c.text)
		.join('\n')

const brief = {
	name: 'write_as_me',
	arguments: { brief: 'напиши, что задержусь' },
}

describe('OAuth', () => {
	it('refuses to register a redirect outside the allowlist', async () => {
		assert.equal((await register('https://evil.example/cb')).status, 400)
		assert.equal((await register(REDIRECT)).status, 201)
	})

	it('issues tokens for a Telegram login, and a code works once', async () => {
		const result = await authorize(OWNER)
		assert.equal(result.status, 200)
		assert.equal(result.reuseStatus, 400)
		assert.ok(result.tokens?.access_token)
	})

	it('refuses a login signed with another bot token', async () => {
		assert.equal((await authorize(OWNER, '999:forged')).status, 400)
	})

	it('answers /mcp without a token with 401 and the metadata pointer', async () => {
		const res = await fetch(`${base}/mcp`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		})
		assert.equal(res.status, 401)
		assert.ok(res.headers.get('www-authenticate').includes('oauth-protected-resource'))
	})
})

describe('MCP over HTTP', () => {
	it("serves each user their own corpus and nobody else's", async () => {
		seedCorpus(OWNER)

		const owner = await mcpClient((await authorize(OWNER)).tokens!.access_token)
		assert.ok(textOf(await owner.callTool(brief)).includes('# ПРИМЕРЫ ИЗ АРХИВА'))

		const stranger = await mcpClient((await authorize(STRANGER)).tokens!.access_token)
		assert.ok(textOf(await stranger.callTool(brief)).includes('Корпус не собран'))
	})
})

describe('account', () => {
	async function sessionCookie(userId: string) {
		const url = new URL(`${base}/account/login`)
		for (const [k, v] of Object.entries(telegram(userId))) {
			url.searchParams.set(k, v)
		}
		const res = await fetch(url, { redirect: 'manual' })
		assert.equal(res.status, 302)
		return res.headers.get('set-cookie')!.split(';')[0]!
	}

	const upload = (cookie: string, body: string, origin = base) =>
		fetch(`${base}/account/upload`, {
			method: 'PUT',
			headers: { cookie, origin, 'content-type': 'application/octet-stream' },
			body,
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

	it('deletes everything the user has', async () => {
		seedCorpus(OWNER)
		const cookie = await sessionCookie(OWNER)
		const res = await fetch(`${base}/account/delete`, {
			method: 'POST',
			headers: { cookie, origin: base },
			redirect: 'manual',
		})
		assert.equal(res.status, 302)
		assert.equal(users.hasCorpus(OWNER), false)
	})
})

describe('voice mode', () => {
	it('sends the profile as instructions only while the switch is on', async () => {
		seedCorpus(OWNER)
		const token = (await authorize(OWNER)).tokens!.access_token

		assert.equal((await mcpClient(token)).getInstructions(), undefined)

		users.saveSettings(OWNER, { ...users.settings(OWNER), voice: true })
		const instructions = (await mcpClient(token)).getInstructions()
		assert.ok(instructions.includes('его же голосом'))
		assert.ok(instructions.includes('# Как я пишу'))
	})

	it('offers the same text as a prompt for clients that drop instructions', async () => {
		seedCorpus(OWNER)
		const client = await mcpClient((await authorize(OWNER)).tokens!.access_token)
		const prompt = await client.getPrompt({ name: 'talk-like-me' })
		const text = (prompt.messages[0]!.content as { text: string }).text
		assert.ok(text.includes('# Как я пишу'))
	})

	it('saves the switch from the account form', async () => {
		const url = new URL(`${base}/account/login`)
		for (const [k, v] of Object.entries(telegram(OWNER))) {
			url.searchParams.set(k, v)
		}
		const login = await fetch(url, { redirect: 'manual' })
		const cookie = login.headers.get('set-cookie')!.split(';')[0]!

		const save = (body: string) =>
			fetch(`${base}/account/settings`, {
				method: 'POST',
				headers: {
					cookie,
					origin: base,
					'content-type': 'application/x-www-form-urlencoded',
				},
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
