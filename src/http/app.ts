import { createWriteStream, mkdirSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { log } from '@aimuzov/infra-mcp-kit'
import {
	apiError,
	createHttpApp,
	errorPage,
	requireSession,
	sameOrigin,
	sendJson,
	sessions,
	sqliteStore,
	telegramLogin,
	telegramUser,
	Tokens,
	type AuthStore,
	type HttpContext,
} from '@aimuzov/infra-mcp-kit/http'
import express, { type Express } from 'express'

import { createServer } from '#thinks/mcp/server'

import { migrateAuthDb } from './auth-db.ts'
import { Builds, childRunner, type BuildStatus } from './builds.ts'
import { loadThinksHttpConfig, type ThinksHttpConfig } from './config.ts'
import { DEFAULT_SETTINGS, Users, type UserSettings } from './users.ts'

export const SERVICE = { name: 'thinks' }

/** Страницы, которые собрал Astro: рядом со сборкой сервера, и в build/, и из исходников. */
export const PUBLIC_DIR = fileURLToPath(new URL('../../build/public', import.meta.url))

export type AppDeps = {
	cfg: ThinksHttpConfig
	store: AuthStore
	users: Users
	builds: Builds
	/** Каталог со страницами Astro. По умолчанию PUBLIC_DIR, тестам хватает заглушек кита. */
	publicDir?: string
}

/** Что кабинет получает от `GET /account/state`. */
export type AccountState = {
	name: string
	hasCorpus: boolean
	status: BuildStatus | null
	settings: UserSettings
	maxUploadBytes: number
	/** Загрузку или сборку уже не остановить, и удалить аккаунт пока нельзя. */
	busy: boolean
}

/**
 * The cookie name predates the kit; keeping it keeps everyone logged in
 * across the move.
 */
const SESSION_COOKIE = 'thinks_session'

export function createApp({ cfg, store, users, builds, publicDir = PUBLIC_DIR }: AppDeps): Express {
	const { http } = cfg
	const telegram = { botToken: cfg.telegramBotToken, devUserId: cfg.devUserId }
	// Shared with the account cookie, so it is built here, not by the kit.
	const tokens = new Tokens({ secret: http.authSecret, issuer: http.publicUrl.href })

	const { app } = createHttpApp({
		config: http,
		service: SERVICE,
		publicDir,
		auth: {
			store,
			tokens,
			login: telegramLogin(telegram),
		},
		// The user id only ever comes from a verified token,
		// and Users checks it once more.
		createServer: (auth) => {
			const userId = String(auth?.extra?.subject)

			return createServer(users.config(userId), users.corpus(userId))
		},
		routes: (app, context) => mountAccount(app, context, { cfg, users, builds }),
	})

	return app
}

type AccountDeps = {
	cfg: ThinksHttpConfig
	users: Users
	builds: Builds
}

function mountAccount(app: Express, { tokens }: HttpContext, { cfg, users, builds }: AccountDeps) {
	const { publicUrl } = cfg.http
	const session = sessions(tokens, publicUrl, SESSION_COOKIE)
	const signedIn = requireSession(session)
	const origin = sameOrigin(publicUrl)
	const userOf = (res: express.Response) => String(res.locals.session.sub)

	const state = (userId: string, name: string): AccountState => {
		const status = builds.status(userId)

		return {
			name: name || userId,
			hasCorpus: users.hasCorpus(userId),
			status,
			settings: users.settings(userId),
			maxUploadBytes: cfg.maxUploadBytes,
			busy: !builds.canDelete(userId),
		}
	}

	app.get('/account/state', signedIn, (_req, res) => {
		sendJson(res, state(userOf(res), String(res.locals.session.name ?? '')))
	})

	// Страница входа статична и не знает, как запущен сервер: на localhost
	// у неё вместо виджета dev-ссылка, а имя бота -- то, которым сервер проверяет подпись.
	app.get('/account/auth', (_req, res) => {
		sendJson(res, { botName: cfg.telegramBotName, dev: cfg.devUserId || null })
	})

	// Сюда виджет Telegram возвращает человека с подписанным query.
	app.get('/account/login', async (req, res) => {
		const login = telegramUser(req, { botToken: cfg.telegramBotToken, devUserId: cfg.devUserId })

		if (!login) {
			return void res.redirect(
				302,
				errorPage({ code: 'login', title: 'Telegram не подтвердил вход', message: 'Попробуй войти ещё раз.' }),
			)
		}

		await session.write(res, { sub: login.id, name: login.firstName || login.username })
		res.redirect(302, '/account')
	})

	app.post('/account/logout', origin, (_req, res) => {
		session.clear(res)
		sendJson(res, { ok: true })
	})

	app.put('/account/upload', origin, signedIn, async (req, res) => {
		const userId = userOf(res)

		if (Number(req.get('content-length')) > cfg.maxUploadBytes) {
			return void apiError(res, 413, 'too_large', 'Файл больше допустимого')
		}

		// Две загрузки одного пользователя писали бы в один и тот же файл.
		if (!builds.beginUpload(userId)) {
			return void apiError(res, 409, 'busy', 'Предыдущая загрузка или сборка ещё не закончилась')
		}

		try {
			mkdirSync(users.dir(userId), { recursive: true })
			await pipeline(req, sizeLimit(cfg.maxUploadBytes), createWriteStream(builds.dumpPath(userId)))
		} catch (err) {
			builds.discardUpload(userId)

			return void uploadFailed(res, err, userId)
		} finally {
			builds.endUpload(userId)
		}

		builds.enqueue(userId)
		sendJson(res, state(userId, String(res.locals.session.name ?? '')), 202)
	})

	app.post('/account/settings', origin, signedIn, express.json({ limit: '16kb' }), (req, res) => {
		// Старая форма кабинета слала urlencoded, и вкладка, открытая до деплоя, пришла бы
		// с пустым для express.json телом: настройки сбросились бы к умолчаниям.
		if (!req.is('application/json')) {
			return void apiError(res, 415, 'json_only', 'Обнови страницу кабинета и сохрани ещё раз')
		}

		const userId = userOf(res)
		const body = (req.body ?? {}) as Record<string, unknown>
		const years = Number.parseInt(String(body.recentYears ?? ''), 10)

		users.saveSettings(userId, {
			neverMarks: String(body.neverMarks ?? '').trim(),
			chatStopList: String(body.chatStopList ?? '').trim(),
			recentYears: years >= 1 && years <= 20 ? years : DEFAULT_SETTINGS.recentYears,
			voice: body.voice === true,
		})

		sendJson(res, state(userId, String(res.locals.session.name ?? '')))
	})

	app.post('/account/delete', origin, signedIn, (_req, res) => {
		const userId = userOf(res)

		// Идущую сборку не остановить, а её статус и корпус легли бы в уже
		// удалённый каталог.
		if (!builds.cancel(userId)) {
			return void apiError(res, 409, 'busy', 'Дождись конца сборки, потом удаляй аккаунт')
		}

		users.remove(userId)
		session.clear(res)
		sendJson(res, { ok: true })
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
	if (err instanceof TooLarge) return apiError(res, 413, 'too_large', 'Файл больше допустимого')

	const code = (err as NodeJS.ErrnoException).code

	// Клиент оборвал загрузку: ответ до него уже не дойдёт, и это не сбой сервера.
	if (code === 'ECONNRESET' || code === 'ERR_STREAM_PREMATURE_CLOSE') {
		return apiError(res, 400, 'aborted', 'Загрузка оборвалась')
	}

	log.error(`Не удалось сохранить загрузку ${userId}`, { error: String(err) })
	apiError(res, 500, 'upload_failed', 'Не удалось сохранить файл, попробуй позже')
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
