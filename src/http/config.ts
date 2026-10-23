type Env = Record<string, string | undefined>

/** What the hosted server needs on top of the per-user corpus config. */
export interface HttpConfig {
  port: number
  /** Public origin the server is reached at, e.g. https://thinks-mcp.aimuzov.online */
  publicUrl: URL
  /** Signs access, refresh and session tokens. */
  authSecret: string
  /** Bot that backs the Telegram Login widget; its domain must be publicUrl. */
  telegramBotToken: string
  telegramBotName: string
  /**
   * Redirect URIs a client may register. Without the list anyone could register
   * a client that sends the code to their own host, send a victim the authorize
   * link and read the victim's corpus once they log in.
   */
  allowedRedirectUris: string[]
  /** Root of users/<telegram id>/ and the server's own auth.db. */
  dataDir: string
  /** Largest Telegram export accepted for upload. */
  maxUploadBytes: number
  /**
   * Log in as this Telegram id without the widget. The widget only works on the
   * domain the bot is bound to, so this is how the server is tried on
   * localhost; it refuses to start with it anywhere else.
   */
  devUserId: string
}

const DEFAULT_PORT = 8080
const DEFAULT_MAX_UPLOAD_MB = 2048

/** Claude's OAuth callbacks; loopback is allowed on top of these for Claude Code. */
const CLAUDE_CALLBACKS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
]

export function loadHttpConfig(env: Env = process.env): HttpConfig {
  const required = (name: string): string => {
    const value = env[name]?.trim()
    if (!value) throw new Error(`Не задана переменная окружения ${name}`)
    return value
  }

  const authSecret = required('AUTH_SECRET')
  if (authSecret.length < 32) {
    throw new Error('AUTH_SECRET слишком короткий: нужно минимум 32 символа')
  }

  const publicUrl = new URL(required('PUBLIC_URL'))
  const devUserId = env.THINKS_DEV_USER_ID?.trim() ?? ''
  if (devUserId && !isLoopback(publicUrl)) {
    throw new Error(
      'THINKS_DEV_USER_ID разрешён только при PUBLIC_URL на localhost'
    )
  }

  const configured = (env.ALLOWED_REDIRECT_URIS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  return {
    port: Number.parseInt(env.PORT ?? '', 10) || DEFAULT_PORT,
    publicUrl,
    authSecret,
    telegramBotToken: devUserId ? '' : required('TELEGRAM_BOT_TOKEN'),
    telegramBotName: devUserId ? '' : required('TELEGRAM_BOT_NAME'),
    allowedRedirectUris: configured.length ? configured : CLAUDE_CALLBACKS,
    dataDir: required('THINKS_DATA_DIR'),
    maxUploadBytes:
      (Number.parseInt(env.THINKS_MAX_UPLOAD_MB ?? '', 10) ||
        DEFAULT_MAX_UPLOAD_MB) *
      1024 *
      1024,
    devUserId,
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

export function isLoopback(url: URL): boolean {
  return LOOPBACK.has(url.hostname)
}

/**
 * A redirect URI is acceptable when it is on the list, or when it is a
 * loopback http URI: Claude Code listens on a random local port, and a code
 * sent to the user's own machine cannot be intercepted by someone else.
 */
export function isAllowedRedirectUri(cfg: HttpConfig, uri: string): boolean {
  if (cfg.allowedRedirectUris.includes(uri)) return true
  if (!URL.canParse(uri)) return false
  const url = new URL(uri)
  return url.protocol === 'http:' && isLoopback(url)
}
