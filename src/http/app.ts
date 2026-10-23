import { createWriteStream, mkdirSync } from 'node:fs'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer } from '../mcp/server.js'
import { ThinksOAuthProvider } from './auth/provider.js'
import { AuthStore } from './auth/store.js'
import { verifyTelegramLogin, type TelegramLogin } from './auth/telegram.js'
import { TTL, Tokens } from './auth/tokens.js'
import { Builds, childRunner } from './builds.js'
import { isLoopback, loadHttpConfig, type HttpConfig } from './config.js'
import {
  accountLoginPage,
  accountPage,
  escapeHtml,
  landingPage,
} from './pages.js'
import { DEFAULT_SETTINGS, Users } from './users.js'

export interface AppDeps {
  cfg: HttpConfig
  store: AuthStore
  users: Users
  builds: Builds
  tokens: Tokens
}

const SESSION_COOKIE = 'thinks_session'

export function createApp({ cfg, store, users, builds, tokens }: AppDeps) {
  const app = express()
  // Caddy terminates TLS in front of us; rate limits need the client address.
  app.set('trust proxy', 1)

  const provider = new ThinksOAuthProvider(cfg, store, tokens)
  const mcpUrl = new URL('/mcp', cfg.publicUrl)

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: cfg.publicUrl,
      resourceServerUrl: mcpUrl,
      resourceName: 'thinks',
    })
  )

  /** Who the Telegram widget (or, on localhost, the dev link) says this is. */
  const login = (req: Request): TelegramLogin | null => {
    if (cfg.devUserId && req.query.dev === '1') {
      return { id: cfg.devUserId, firstName: 'dev', username: '' }
    }
    return verifyTelegramLogin(req.query, cfg.telegramBotToken)
  }

  app.get('/authorize/callback', async (req, res) => {
    const request = await tokens.verify('authorize', String(req.query.request))
    if (!request)
      return fail(res, 'Ссылка входа устарела, начни подключение заново')

    const user = login(req)
    if (!user) return fail(res, 'Telegram не подтвердил вход')

    const client = store.getClient(request.sub)
    const redirectUri = String(request.redirect_uri)
    if (!client || !client.redirect_uris.includes(redirectUri)) {
      return fail(res, 'Клиент не зарегистрирован')
    }

    const code = store.issueCode({
      userId: user.id,
      clientId: client.client_id,
      codeChallenge: String(request.code_challenge),
      redirectUri,
    })
    const target = new URL(redirectUri)
    target.searchParams.set('code', code)
    if (request.state) target.searchParams.set('state', String(request.state))
    res.redirect(302, target.href)
  })

  // Stateless: every request gets its own server and transport, so nothing
  // ties a client to one process and a restart drops no sessions.
  app.post(
    '/mcp',
    requireBearerAuth({
      verifier: provider,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
    }),
    express.json({ limit: '1mb' }),
    async (req, res) => {
      const userId = String(req.auth?.extra?.userId)
      const server = createServer(users.config(userId), users.corpus(userId))
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      })
      res.on('close', () => {
        void transport.close()
        void server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    }
  )
  app.all('/mcp', (_req, res) => {
    res.status(405).set('Allow', 'POST').end()
  })

  app.get('/', (_req, res) => {
    res.type('html').send(landingPage(cfg))
  })

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  // --- Account ---

  const session = async (
    req: Request
  ): Promise<{ id: string; name: string } | null> => {
    const token = readCookie(req, SESSION_COOKIE)
    if (!token) return null
    const claims = await tokens.verify('session', token)
    return claims ? { id: claims.sub, name: String(claims.name ?? '') } : null
  }

  /**
   * Account forms change and delete data with nothing but the cookie behind
   * them. SameSite=Lax already keeps the cookie off cross-site posts; the
   * Origin check closes what is left.
   */
  const sameOrigin = (req: Request, res: Response, next: NextFunction) => {
    if (req.get('origin') === cfg.publicUrl.origin) return next()
    res.status(403).send('Запрос пришёл не со страницы кабинета')
  }

  app.get('/account', async (req, res) => {
    const user = await session(req)
    if (!user) return res.type('html').send(accountLoginPage(cfg))
    res.type('html').send(
      accountPage(cfg, {
        name: user.name || user.id,
        hasCorpus: users.hasCorpus(user.id),
        status: builds.status(user.id),
        settings: users.settings(user.id),
      })
    )
  })

  app.get('/account/login', async (req, res) => {
    const user = login(req)
    if (!user) return fail(res, 'Telegram не подтвердил вход')
    const token = await tokens.sign('session', {
      sub: user.id,
      name: user.firstName || user.username,
    })
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: !isLoopback(cfg.publicUrl),
      sameSite: 'lax',
      maxAge: TTL.session * 1000,
      path: '/',
    })
    res.redirect(302, '/account')
  })

  app.post('/account/logout', sameOrigin, (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' })
    res.redirect(302, '/account')
  })

  app.put('/account/upload', sameOrigin, async (req, res) => {
    const user = await session(req)
    if (!user) return res.status(401).send('Войди заново')

    const declared = Number(req.get('content-length'))
    if (declared > cfg.maxUploadBytes) {
      return res.status(413).send('Файл больше допустимого')
    }
    const state = builds.status(user.id)?.state
    if (state === 'queued' || state === 'building') {
      return res.status(409).send('Предыдущая сборка ещё не закончилась')
    }

    mkdirSync(users.dir(user.id), { recursive: true })
    try {
      await pipeline(
        req,
        sizeLimit(cfg.maxUploadBytes),
        createWriteStream(builds.dumpPath(user.id))
      )
    } catch {
      builds.discardUpload(user.id)
      return res
        .status(413)
        .send('Загрузка оборвалась или файл слишком большой')
    }
    builds.enqueue(user.id)
    res.status(202).send('Сборка поставлена в очередь')
  })

  app.post(
    '/account/settings',
    sameOrigin,
    express.urlencoded({ extended: false, limit: '16kb' }),
    async (req, res) => {
      const user = await session(req)
      if (!user) return res.redirect(302, '/account')
      const years = Number.parseInt(String(req.body.recentYears ?? ''), 10)
      users.saveSettings(user.id, {
        neverMarks: String(req.body.neverMarks ?? '').trim(),
        chatStopList: String(req.body.chatStopList ?? '').trim(),
        recentYears:
          years >= 1 && years <= 20 ? years : DEFAULT_SETTINGS.recentYears,
      })
      res.redirect(302, '/account')
    }
  )

  app.post('/account/delete', sameOrigin, async (req, res) => {
    const user = await session(req)
    if (!user) return res.redirect(302, '/account')
    users.remove(user.id)
    res.clearCookie(SESSION_COOKIE, { path: '/' })
    res.redirect(302, '/')
  })

  return app
}

function fail(res: Response, message: string) {
  res
    .status(400)
    .type('html')
    .send(
      `<!doctype html><meta charset="utf-8"><p>${escapeHtml(message)}</p><p><a href="/account">В кабинет</a></p>`
    )
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

/** Fail the stream once more than `max` bytes have gone through. */
function sizeLimit(max: number): Transform {
  let seen = 0
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      seen += chunk.length
      if (seen > max) done(new Error('too large'))
      else done(null, chunk)
    },
  })
}

/** Run the hosted server. Configured entirely from the environment. */
export function serveHttp(): void {
  const cfg = loadHttpConfig()
  mkdirSync(cfg.dataDir, { recursive: true })

  const users = new Users(cfg.dataDir)
  const heapMb =
    Number.parseInt(process.env.THINKS_BUILD_HEAP_MB ?? '', 10) || 1024
  const builds = new Builds(users, cfg.dataDir, childRunner(heapMb))
  builds.recover(users.list())

  const app = createApp({
    cfg,
    store: new AuthStore(join(cfg.dataDir, 'auth.db')),
    users,
    builds,
    tokens: new Tokens(cfg.authSecret, cfg.publicUrl.href),
  })
  app.listen(cfg.port, () => {
    console.error(
      `thinks-mcp listening on :${cfg.port} as ${cfg.publicUrl.href}`
    )
  })
}
