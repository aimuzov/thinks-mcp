import type { TextEntity } from './types.js'

/**
 * Placeholders keep the shape of a sentence while dropping its payload. They are
 * deliberately short: the style profile measures message length, so a redaction
 * that ballooned the text would skew every metric downstream.
 */
const PLACEHOLDER: Record<string, string> = {
  phone: '<телефон>',
  email: '<почта>',
  bank_card: '<карта>',
  link: '<ссылка>',
  mention: '@собеседник',
  mention_name: '@собеседник',
}

/** Entity types dropped outright — their text carries no voice of its own. */
const DROPPED = new Set(['bot_command'])

// Safety net for PII that Telegram failed to tag as an entity.
const RAW_EMAIL = /\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/gi
const RAW_PHONE = /(?:\+?\d[\d\s()-]{9,}\d)/g
const RAW_CARD = /\b(?:\d[ -]?){13,19}\b/g

/** The bare words a placeholder contributes, so the lexicon can veto them. */
export const PLACEHOLDER_WORDS = new Set([
  'ссылка',
  'телефон',
  'почта',
  'карта',
  'имя',
  'собеседник',
])

/**
 * Prefixes of the first names present in the dump.
 *
 * Russian diminutives keep the stem of the name they come from, so a prefix
 * match catches the forms an exact match misses. Used to keep people out of the
 * style profile — the profile is a document about how the owner writes, not
 * about who they talk to.
 */
export function namePrefixes(names: Iterable<string>, length = 4): Set<string> {
  const out = new Set<string>()
  for (const name of names) {
    const first = name.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    if (first.length >= length) out.add(first.slice(0, length))
  }
  return out
}

export interface Sanitizer {
  /** Render entities to plain text with private data removed. */
  clean(entities: TextEntity[]): string
  /** Same, for text that never had entities (reply context excerpts). */
  cleanText(text: string): string
}

/**
 * Build a sanitizer.
 *
 * `surnames` are scrubbed from message bodies; first names deliberately are not.
 * A bare first name identifies nobody and appears constantly in real dialogue —
 * replacing it would make every example read like a redacted document, which is
 * exactly what the examples must not be. Real names never reach the database as
 * metadata regardless: chats and senders are stored under pseudonyms.
 */
export function createSanitizer(surnames: Iterable<string>): Sanitizer {
  const list = [
    ...new Set([...surnames].map(s => s.trim()).filter(s => s.length >= 4)),
  ]
  // Longest first so "Ивановский" is not half-matched by "Иванов".
  list.sort((a, b) => b.length - a.length)
  const surnameRe = list.length
    ? new RegExp(`\\b(?:${list.map(escapeRe).join('|')})\\w*`, 'gi')
    : null

  const scrub = (text: string): string => {
    let out = text
      .replace(RAW_EMAIL, PLACEHOLDER.email)
      .replace(RAW_CARD, PLACEHOLDER.bank_card)
      .replace(RAW_PHONE, m => (digitCount(m) >= 10 ? PLACEHOLDER.phone : m))
    if (surnameRe) out = out.replace(surnameRe, '<имя>')
    return out.replace(/[ \t]+/g, ' ').trim()
  }

  return {
    clean(entities) {
      const parts: string[] = []
      for (const e of entities) {
        if (DROPPED.has(e.type)) continue
        // text_link keeps its visible text — that text is the author's own
        // words, only the href behind it is dropped.
        const replacement = e.type === 'text_link' ? null : PLACEHOLDER[e.type]
        parts.push(replacement ?? e.text)
      }
      return scrub(parts.join(''))
    },
    cleanText: scrub,
  }
}

/** Collect sender surnames across the dump, to feed createSanitizer. */
export function collectSurnames(names: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const name of names) {
    const words = name.trim().split(/\s+/)
    // "Ivan Petrov" -> Petrov. Single-word names carry no surname.
    if (words.length >= 2) {
      for (const w of words.slice(1)) out.add(w)
    }
  }
  return out
}

function digitCount(s: string): number {
  let n = 0
  for (const ch of s) if (ch >= '0' && ch <= '9') n++
  return n
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
