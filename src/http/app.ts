import { createWriteStream, mkdirSync, readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { log } from '@aimuzov/infra-mcp-kit'
import {
	createHttpApp,
	sameOrigin,
	sessions,
	sqliteStore,
	telegramLogin,
	telegramUser,
	Tokens,
	ui,
	type AuthStore,
	type HttpContext,
} from '@aimuzov/infra-mcp-kit/http'
import express, { type Express } from 'express'

import { createServer } from '#thinks/mcp/server'

import { migrateAuthDb } from './auth-db.ts'
import { Builds, childRunner } from './builds.ts'
import { loadThinksHttpConfig, type ThinksHttpConfig } from './config.ts'
import { ACCOUNT_SCRIPT, accountLoginPage, accountPage, GRANTS, LANDING, SERVICE } from './pages.ts'
import { DEFAULT_SETTINGS, Users } from './users.ts'

export type AppDeps = {
	cfg: ThinksHttpConfig
	store: AuthStore
	users: Users
	builds: Builds
}

/**
 * The cookie name predates the kit; keeping it keeps everyone logged in
 * across the move.
 */
const SESSION_COOKIE = 'thinks_session'

const accountScript = readFileSync(new URL('./assets/account.js', import.meta.url), 'utf8')

export function createApp({ cfg, store, users, builds }: AppDeps): Express {
	const { http } = cfg
	const telegram = { botToken: cfg.telegramBotToken, botName: cfg.telegramBotName, devUserId: cfg.devUserId }
	// Shared with the account cookie, so it is built here, not by the kit.
	const tokens = new Tokens({ secret: http.authSecret, issuer: http.publicUrl.href })

	const { app } = createHttpApp({
		config: http,
		service: SERVICE,
		auth: {
			store,
			tokens,
			login: telegramLogin({ ...telegram, grants: GRANTS }),
		},
		// The user id only ever comes from a verified token,
		// and Users checks it once more.
		createServer: (auth) => {
			const userId = String(auth?.extra?.subject)

			return createServer(users.config(userId), users.corpus(userId))
		},
		landing: LANDING,
		routes: (app, context) => mountAccount(app, context, { cfg, users, builds, telegram }),
	})

	return app
}

type AccountDeps = {
	cfg: ThinksHttpConfig
	users: Users
	builds: Builds
	telegram: { botToken: string; botName: string; devUserId: string }
}

function mountAccount(app: Express, { tokens, mcpUrl }: HttpContext, { cfg, users, builds, telegram }: AccountDeps) {
	const { publicUrl } = cfg.http
	const session = sessions(tokens, publicUrl, SESSION_COOKIE)
	const origin = sameOrigin(publicUrl)
	const fail = (res: express.Response, title: string, status = 400) =>
		res
			.status(status)
			.type('html')
			.send(ui.failPage({ service: SERVICE, title, href: '/account', hrefLabel: 'В кабинет' }))

	const user = async (req: express.Request) => {
		const claims = await session.read(req)

		return claims && { id: claims.sub, name: String(claims.name ?? '') }
	}

	app.get(ACCOUNT_SCRIPT, (_req, res) => void res.type('text/javascript').send(accountScript))

	app.get('/account', async (req, res) => {
		const me = await user(req)

		if (!me) return void res.type('html').send(accountLoginPage(new URL('/account/login', publicUrl), telegram))

		res.type('html').send(
			accountPage({
				name: me.name || me.id,
				mcpUrl: mcpUrl.href,
				hasCorpus: users.hasCorpus(me.id),
				status: builds.status(me.id),
				settings: users.settings(me.id),
				maxUploadBytes: cfg.maxUploadBytes,
			}),
		)
	})

	app.get('/account/login', async (req, res) => {
		const login = telegramUser(req, telegram)

		if (!login) return void fail(res, 'Telegram не подтвердил вход')

		await session.write(res, { sub: login.id, name: login.firstName || login.username })
		res.redirect(302, '/account')
	})

	app.post('/account/logout', origin, (_req, res) => {
		session.clear(res)
		res.redirect(302, '/account')
	})

	app.put('/account/upload', origin, async (req, res) => {
		const me = await user(req)

		if (!me) return void res.status(401).send('Войди заново')

		if (Number(req.get('content-length')) > cfg.maxUploadBytes) {
			return void res.status(413).send('Файл больше допустимого')
		}

		// Две загрузки одного пользователя писали бы в один и тот же файл.
		if (!builds.beginUpload(me.id)) {
			return void res.status(409).send('Предыдущая загрузка или сборка ещё не закончилась')
		}

		try {
			mkdirSync(users.dir(me.id), { recursive: true })
			await pipeline(req, sizeLimit(cfg.maxUploadBytes), createWriteStream(builds.dumpPath(me.id)))
		} catch (err) {
			builds.discardUpload(me.id)

			return void uploadFailed(res, err, me.id)
		} finally {
			builds.endUpload(me.id)
		}

		builds.enqueue(me.id)
		res.status(202).send('Сборка поставлена в очередь')
	})

	app.post('/account/settings', origin, express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
		const me = await user(req)

		if (!me) return void res.redirect(302, '/account')

		const years = Number.parseInt(String(req.body.recentYears ?? ''), 10)

		users.saveSettings(me.id, {
			neverMarks: String(req.body.neverMarks ?? '').trim(),
			chatStopList: String(req.body.chatStopList ?? '').trim(),
			recentYears: years >= 1 && years <= 20 ? years : DEFAULT_SETTINGS.recentYears,
			voice: req.body.voice === '1',
		})

		res.redirect(302, '/account')
	})

	app.post('/account/delete', origin, async (req, res) => {
		const me = await user(req)

		if (!me) return void res.redirect(302, '/account')

		// Идущую сборку не остановить, а её статус и корпус легли бы в уже
		// удалённый каталог.
		if (!builds.cancel(me.id)) return void fail(res, 'Дождись конца сборки, потом удаляй аккаунт', 409)

		users.remove(me.id)
		session.clear(res)
		res.redirect(302, '/')
	})
}

class TooLarge extends Error {}

/** Fail the stream once more than `max` bytes have gone through. */
function sizeLimit(max: number): Transform {
	let seen = 0

	return new Transform({
		transform(chunk: Buffer, _enc, done) {
			seen += chunk.length

			if (seen > max) done(new TooLarge('too large'))
			else done(null, chunk)
		},
	})
}

/** Only an oversized file is the user's fault; a full disk is ours. */
function uploadFailed(res: express.Response, err: unknown, userId: string): void {
	if (err instanceof TooLarge) {
		res.status(413).send('Файл больше допустимого')

		return
	}

	const code = (err as NodeJS.ErrnoException).code

	// Клиент оборвал загрузку: ответ до него уже не дойдёт, и это не сбой сервера.
	if (code === 'ECONNRESET' || code === 'ERR_STREAM_PREMATURE_CLOSE') {
		res.status(400).send('Загрузка оборвалась')

		return
	}

	log.error(`Не удалось сохранить загрузку ${userId}`, { error: String(err) })
	res.status(500).send('Не удалось сохранить файл, попробуй позже')
}

/** Run the hosted server. Configured entirely from the environment. */
export async function serveHttp(): Promise<Server> {
	const cfg = loadThinksHttpConfig()

	mkdirSync(cfg.dataDir, { recursive: true })

	const users = new Users(cfg.dataDir)
	const builds = new Builds(users, cfg.dataDir, childRunner(cfg.buildHeapMb))

	builds.recover(users.list())

	const authDb = join(cfg.dataDir, 'auth.db')

	migrateAuthDb(authDb)

	const app = createApp({ cfg, store: sqliteStore(authDb), users, builds })

	const server = await listen(app, cfg.http.port)

	log.info(`${SERVICE.name} listening on :${cfg.http.port} as ${cfg.http.publicUrl.href}`)

	return server
}

/** Resolves once the port is bound; rejects when it cannot be, e.g. EADDRINUSE. */
export function listen(app: Express, port: number): Promise<Server> {
	return new Promise((resolve, reject) => {
		// Express 5 отдаёт ошибку listen в этот же колбэк; без проверки занятый
		// порт выглядел бы успешным стартом.
		const server = app.listen(port, (err?: Error) => (err ? reject(err) : resolve(server)))
	})
}
