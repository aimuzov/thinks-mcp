import type { ParsedMessage } from './types.js'

/** Why a message did not make it into the corpus. `null` means it was kept. */
export type RejectReason =
  | 'not-owner'
  | 'empty'
  | 'forwarded'
  | 'via-bot'
  | 'structured'
  | 'link-spam'

export type FilterStats = Record<RejectReason | 'kept', number>

export function emptyStats(): FilterStats {
  return {
    'not-owner': 0,
    empty: 0,
    forwarded: 0,
    'via-bot': 0,
    structured: 0,
    'link-spam': 0,
    kept: 0,
  }
}

const STRUCTURAL_CHARS = new Set(['{', '}', '[', ']', '<', '>', ';', '='])
const MAX_STRUCTURAL_SHARE = 0.03
const MAX_LINKS = 3

/**
 * Decide whether a message is the owner writing in their own voice.
 *
 * The two rules that matter most: forwards are someone else's text (25.6k of
 * them in the source dump, and 59% of all messages over 300 characters), and
 * pasted JSON or log output is nobody's voice at all. Without both filters the
 * longform register would be trained mostly on other people's writing.
 */
export function reject(m: ParsedMessage, ownerId: string): RejectReason | null {
  if (m.fromId !== ownerId) return 'not-owner'
  if (m.isForwarded) return 'forwarded'
  if (m.isViaBot) return 'via-bot'

  const text = m.text.trim()
  if (!text) return 'empty'

  if (text.startsWith('{') || text.startsWith('[') || text.startsWith('<')) {
    return 'structured'
  }

  let structural = 0
  for (const ch of text) if (STRUCTURAL_CHARS.has(ch)) structural++
  if (structural / text.length > MAX_STRUCTURAL_SHARE) return 'structured'

  let links = 0
  for (const e of m.entities)
    if (e.type === 'link' || e.type === 'text_link') links++
  if (links > MAX_LINKS) return 'link-spam'

  return null
}

/**
 * A sanitized message worth keeping. Text that survived redaction as nothing but
 * placeholders and punctuation ("<ссылка>", ")") teaches no style.
 */
export function hasSubstance(sanitized: string): boolean {
  const withoutPlaceholders = sanitized.replace(/<[^>]{1,12}>|@собеседник/g, '')
  return /\p{L}/u.test(withoutPlaceholders)
}
