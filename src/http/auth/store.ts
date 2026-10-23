import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'

/** An authorization code waiting to be exchanged. */
export interface PendingCode {
  userId: string
  clientId: string
  codeChallenge: string
  redirectUri: string
}

const CODE_TTL_MS = 5 * 60 * 1000

const SCHEMA = [
  'PRAGMA journal_mode = WAL',
  `CREATE TABLE IF NOT EXISTS client (
     client_id TEXT PRIMARY KEY,
     info      TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS auth_code (
     code       TEXT PRIMARY KEY,
     user_id    TEXT NOT NULL,
     client_id  TEXT NOT NULL,
     challenge  TEXT NOT NULL,
     redirect   TEXT NOT NULL,
     expires_at INTEGER NOT NULL
   )`,
]

/**
 * Registered clients and authorization codes.
 *
 * Tokens are signed and need no storage, but these two do: a client registers
 * once and comes back with only its id, and a code must be usable exactly once,
 * which a signature alone cannot promise.
 */
export class AuthStore {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    for (const sql of SCHEMA) this.db.prepare(sql).run()
  }

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = this.db
      .prepare('SELECT info FROM client WHERE client_id = ?')
      .get(clientId) as { info: string } | undefined
    return row
      ? (JSON.parse(row.info) as OAuthClientInformationFull)
      : undefined
  }

  saveClient(client: OAuthClientInformationFull): void {
    this.db
      .prepare('INSERT OR REPLACE INTO client (client_id, info) VALUES (?, ?)')
      .run(client.client_id, JSON.stringify(client))
  }

  issueCode(pending: PendingCode, now = Date.now()): string {
    const code = randomBytes(32).toString('base64url')
    this.db.prepare('DELETE FROM auth_code WHERE expires_at < ?').run(now)
    this.db
      .prepare(
        `INSERT INTO auth_code (code, user_id, client_id, challenge, redirect, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        code,
        pending.userId,
        pending.clientId,
        pending.codeChallenge,
        pending.redirectUri,
        now + CODE_TTL_MS
      )
    return code
  }

  /** Look at a code without spending it: the token handler checks PKCE first. */
  peekCode(code: string, now = Date.now()): PendingCode | undefined {
    const row = this.db
      .prepare(
        `SELECT user_id, client_id, challenge, redirect FROM auth_code
         WHERE code = ? AND expires_at >= ?`
      )
      .get(code, now) as
      | {
          user_id: string
          client_id: string
          challenge: string
          redirect: string
        }
      | undefined
    if (!row) return undefined
    return {
      userId: row.user_id,
      clientId: row.client_id,
      codeChallenge: row.challenge,
      redirectUri: row.redirect,
    }
  }

  /** Spend a code. Undefined when it was already spent or has expired. */
  takeCode(code: string, now = Date.now()): PendingCode | undefined {
    const pending = this.peekCode(code, now)
    if (!pending) return undefined
    const { changes } = this.db
      .prepare('DELETE FROM auth_code WHERE code = ?')
      .run(code)
    return changes ? pending : undefined
  }

  close(): void {
    this.db.close()
  }
}
