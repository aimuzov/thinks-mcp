import { createWriteStream, mkdirSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { fileURLToPath } from 'node:url'
import { log } from '@aimuzov/infra-mcp-kit'
import {
	apiError,
	createHttpApp,
	errorPage,
	InvalidRequestError,
	listen as listenApp,
	readBody,
	requireSession,
	sameOrigin,
	sendJson,
	sessions,
	sqliteStore,
	telegramLogin,
	telegramUser,
	Tokens,
	type AuthStore,
	type HttpApp,
	type Route,
	type TokenClaims,
} from '@aimuzov/infra-mcp-kit/http'

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

/** Настройки -- несколько коротких строк, больше этого JSON не бывает. */
const SETTINGS_LIMIT = 16 * 1024

export function createApp({ cfg, store, users, builds, publicDir = PUBLIC_DIR }: AppDeps): HttpApp {
	const { http } = cfg
	const telegram = { botToken: cfg.telegramBotToken, devUserId: cfg.devUserId }
	// Shared with the account cookie, so it is built here, not by the kit.
	const tokens = new Tokens({ secret: http.authSecret, issuer: http.publicUrl.href })

	return createHttpApp({
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
		routes: accountRoutes({ cfg, store, users, builds }),
	})
}

type AccountDeps = {
	cfg: ThinksHttpConfig
	store: AuthStore
	users: Users
	builds: Builds
}

/** Маршрут кабинета по ключу "МЕТОД /путь": нет ключа -- запрос уходит дальше, к 404 кита. */
type Handler = (request: Request) => Response | Promise<Response>

function accountRoutes({ cfg, store, users, builds }: AccountDeps): Route {
	let session: ReturnType<typeof sessions> | undefined
	let table: Record<string, Handler> | undefined

	// Кит отдаёт свои `tokens` только в контексте запроса: маршруты собираются на первом.
	return (request, context) => {
		session ??= sessions(context.tokens, cfg.http.publicUrl, SESSION_COOKIE)
		table ??= accountTable(session, { cfg, store, users, builds })

		const handler = table[`${request.method} ${new URL(request.url).pathname}`]

		return handler?.(request)
	}
}

function accountTable(
	session: ReturnType<typeof sessions>,
	{ cfg, store, users, builds }: AccountDeps,
): Record<string, Handler> {
	const { publicUrl } = cfg.http

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

	const nameOf = (claims: TokenClaims) => String(claims.name ?? '')

	/** Изменяющий запрос: чужой Origin -- 403, без сессии -- 401. */
	const guarded =
		(fn: (request: Request, claims: TokenClaims) => Response | Promise<Response>, checkOrigin = true): Handler =>
		async (request) => {
			const foreign = checkOrigin ? sameOrigin(publicUrl, request) : undefined

			if (foreign) return foreign

			const claims = await requireSession(session, request)

			if (claims instanceof Response) return claims

			return fn(request, claims)
		}

	return {
		'GET /account/state': guarded((_request, claims) => sendJson(state(String(claims.sub), nameOf(claims))), false),

		// Страница входа статична и не знает, как запущен сервер: на localhost
		// у неё вместо виджета dev-ссылка, а имя бота -- то, которым сервер проверяет подпись.
		'GET /account/auth': () => sendJson({ botName: cfg.telegramBotName, dev: cfg.devUserId || null }),

		// Сюда виджет Telegram возвращает человека с подписанным query.
		'GET /account/login': async (request) => {
			const query = Object.fromEntries(new URL(request.url).searchParams)
			const login = telegramUser(query, { botToken: cfg.telegramBotToken, devUserId: cfg.devUserId })

			if (!login) {
				return redirect(
					errorPage({
						code: 'login',
						title: 'Telegram не подтвердил вход',
						message: 'Попробуй войти ещё раз.',
					}),
				)
			}

			return redirect(
				'/account',
				await session.cookie({ sub: login.id, name: login.firstName || login.username }),
			)
		},

		'POST /account/logout': (request) =>
			sameOrigin(publicUrl, request) ?? sendJson({ ok: true }, 200, { 'set-cookie': session.clearCookie() }),

		'PUT /account/upload': guarded(async (request, claims) => {
			const userId = String(claims.sub)

			if (Number(request.headers.get('content-length')) > cfg.maxUploadBytes) {
				return apiError(413, 'too_large', 'Файл больше допустимого')
			}

			// Две загрузки одного пользователя писали бы в один и тот же файл.
			if (!builds.beginUpload(userId)) {
				return apiError(409, 'busy', 'Предыдущая загрузка или сборка ещё не закончилась')
			}

			try {
				mkdirSync(users.dir(userId), { recursive: true })

				await pipeline(
					request.body ? Readable.fromWeb(request.body as WebReadableStream<Uint8Array>) : Readable.from([]),
					sizeLimit(cfg.maxUploadBytes),
					createWriteStream(builds.dumpPath(userId)),
				)
			} catch (err) {
				builds.discardUpload(userId)

				return uploadFailed(err, userId)
			} finally {
				builds.endUpload(userId)
			}

			builds.enqueue(userId)

			return sendJson(state(userId, nameOf(claims)), 202)
		}),

		'POST /account/settings': guarded(async (request, claims) => {
			// Старая форма кабинета слала urlencoded, и вкладка, открытая до деплоя, пришла бы
			// с пустым телом: настройки сбросились бы к умолчаниям.
			if (!isJson(request)) return apiError(415, 'json_only', 'Обнови страницу кабинета и сохрани ещё раз')

			let body: Record<string, unknown>

			try {
				body = (JSON.parse((await readBody(request, SETTINGS_LIMIT)) || '{}') ?? {}) as Record<string, unknown>
			} catch (err) {
				// Битое или слишком большое тело прислал клиент, сервер тут ни при чём.
				if (err instanceof InvalidRequestError) return apiError(413, 'too_large', 'Слишком большой запрос')

				return apiError(400, 'bad_json', 'Не удалось прочитать настройки')
			}

			const userId = String(claims.sub)
			const years = Number.parseInt(String(body.recentYears ?? ''), 10)

			users.saveSettings(userId, {
				neverMarks: String(body.neverMarks ?? '').trim(),
				chatStopList: String(body.chatStopList ?? '').trim(),
				recentYears: years >= 1 && years <= 20 ? years : DEFAULT_SETTINGS.recentYears,
				voice: body.voice === true,
			})

			return sendJson(state(userId, nameOf(claims)))
		}),

		'POST /account/delete': guarded((_request, claims) => {
			const userId = String(claims.sub)

			// Идущую сборку не остановить, а её статус и корпус легли бы в уже
			// удалённый каталог.
			if (!builds.cancel(userId)) return apiError(409, 'busy', 'Дождись конца сборки, потом удаляй аккаунт')

			// Токены MCP-клиентов живут дольше сессии кабинета: без отзыва
			// клиент продолжил бы ходить в удалённый аккаунт.
			store.revokeSubject(userId)
			users.remove(userId)

			return sendJson({ ok: true }, 200, { 'set-cookie': session.clearCookie() })
		}),
	}
}

function redirect(location: string, cookie?: string): Response {
	const headers = new Headers({ location })

	if (cookie) headers.set('set-cookie', cookie)

	return new Response(null, { status: 302, headers })
}

const isJson = (request: Request) =>
	(request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() === 'application/json'

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
function uploadFailed(err: unknown, userId: string): Response {
	if (err instanceof TooLarge) return apiError(413, 'too_large', 'Файл больше допустимого')

	const code = (err as NodeJS.ErrnoException).code

	// Клиент оборвал загрузку: ответ до него уже не дойдёт, и это не сбой сервера.
	if (code === 'ECONNRESET' || code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ABORT_ERR') {
		return apiError(400, 'aborted', 'Загрузка оборвалась')
	}

	log.error(`Не удалось сохранить загрузку ${userId}`, { error: String(err) })

	return apiError(500, 'upload_failed', 'Не удалось сохранить файл, попробуй позже')
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

	return listen(app, cfg.http.port, `${SERVICE.name} listening on :${cfg.http.port} as ${cfg.http.publicUrl.href}`)
}

/** Resolves once the port is bound; rejects when it cannot be, e.g. EADDRINUSE. */
export function listen(app: HttpApp, port: number, message?: string): Promise<Server> {
	return listenApp(app, port, message)
}
