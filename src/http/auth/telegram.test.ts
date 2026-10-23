import { describe, expect, it } from 'vitest'
import { signTelegramLogin, verifyTelegramLogin } from './telegram.js'

const TOKEN = '123:bot'
const now = 1_700_000_000_000
const fields = { id: '42', first_name: 'Ivan', auth_date: String(now / 1000) }

describe('verifyTelegramLogin', () => {
  it('accepts a fresh login signed with the bot token', () => {
    const login = verifyTelegramLogin(
      signTelegramLogin(fields, TOKEN),
      TOKEN,
      now
    )
    expect(login).toEqual({ id: '42', firstName: 'Ivan', username: '' })
  })

  it('ignores parameters the widget did not sign', () => {
    const query = { ...signTelegramLogin(fields, TOKEN), request: 'anything' }
    expect(verifyTelegramLogin(query, TOKEN, now)?.id).toBe('42')
  })

  it('refuses a changed field', () => {
    const query = { ...signTelegramLogin(fields, TOKEN), id: '43' }
    expect(verifyTelegramLogin(query, TOKEN, now)).toBeNull()
  })

  it('refuses another bot', () => {
    const query = signTelegramLogin(fields, '999:other')
    expect(verifyTelegramLogin(query, TOKEN, now)).toBeNull()
  })

  it('refuses a stale login', () => {
    const query = signTelegramLogin(fields, TOKEN)
    expect(verifyTelegramLogin(query, TOKEN, now + 11 * 60 * 1000)).toBeNull()
  })
})
