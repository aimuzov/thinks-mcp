import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/** Fields the Telegram Login widget appends to its auth URL. */
export interface TelegramLogin {
  id: string
  firstName: string
  username: string
}

/** A login older than this is refused: the signed query must not be replayable. */
const MAX_AGE_SECONDS = 10 * 60

/**
 * Check the widget's signature.
 *
 * The widget signs every field it sends with HMAC-SHA256, keyed with the
 * SHA-256 of the bot token, over `key=value` lines sorted by key. Fields we
 * add to the auth URL ourselves are not signed and must be left out.
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramLogin(
  query: Record<string, unknown>,
  botToken: string,
  now = Date.now()
): TelegramLogin | null {
  const hash = typeof query.hash === 'string' ? query.hash : ''
  if (!/^[0-9a-f]{64}$/.test(hash)) return null

  const lines: string[] = []
  for (const key of SIGNED_FIELDS) {
    const value = query[key]
    if (typeof value === 'string') lines.push(`${key}=${value}`)
  }
  lines.sort()

  const secret = createHash('sha256').update(botToken).digest()
  const expected = createHmac('sha256', secret)
    .update(lines.join('\n'))
    .digest()
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null

  const authDate = Number(query.auth_date)
  if (!Number.isFinite(authDate)) return null
  if (now / 1000 - authDate > MAX_AGE_SECONDS) return null

  const id = String(query.id ?? '')
  if (!/^\d+$/.test(id)) return null

  return {
    id,
    firstName: String(query.first_name ?? ''),
    username: String(query.username ?? ''),
  }
}

const SIGNED_FIELDS = [
  'auth_date',
  'first_name',
  'id',
  'last_name',
  'photo_url',
  'username',
]

/** Sign a login the way Telegram does. Tests only. */
export function signTelegramLogin(
  fields: Record<string, string>,
  botToken: string
): Record<string, string> {
  const data = Object.keys(fields)
    .sort()
    .map(k => `${k}=${fields[k]}`)
    .join('\n')
  const secret = createHash('sha256').update(botToken).digest()
  const hash = createHmac('sha256', secret).update(data).digest('hex')
  return { ...fields, hash }
}
