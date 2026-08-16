import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { ParsedChat, ParsedMessage, TextEntity } from './types.js'

/** Raw shapes we care about in a Telegram JSON export. */
interface RawMessage {
  id?: number
  type?: string
  date_unixtime?: string
  from?: string
  from_id?: string
  text?: unknown
  text_entities?: { type?: string; text?: string }[]
  forwarded_from?: string
  saved_from?: string
  via_bot?: string
  reply_to_message_id?: number
}

interface RawChat {
  id?: number
  name?: string | null
  type?: string
  messages?: RawMessage[]
}

interface RawDump {
  chats?: { list?: RawChat[] }
  left_chats?: { list?: RawChat[] }
}

/**
 * Read and parse the whole export. The 411 MB file parses in ~2s at ~2.3 GB RSS,
 * so a streaming parser buys nothing; the npm script raises the heap instead.
 */
export function readDump(dumpPath: string): RawDump {
  return JSON.parse(readFileSync(dumpPath, 'utf8')) as RawDump
}

function allChats(dump: RawDump): RawChat[] {
  return [...(dump.chats?.list ?? []), ...(dump.left_chats?.list ?? [])]
}

/**
 * Figure out whose export this is. Saved Messages only ever contains the owner,
 * which is the strongest signal; otherwise fall back to the most prolific
 * sender, who in a personal archive is the owner by a wide margin.
 */
export function resolveOwnerId(dump: RawDump): string {
  const chats = allChats(dump)

  for (const chat of chats) {
    if (chat.type !== 'saved_messages') continue
    for (const m of chat.messages ?? []) {
      if (m.from_id) return m.from_id
    }
  }

  const counts = new Map<string, number>()
  for (const chat of chats) {
    for (const m of chat.messages ?? []) {
      if (!m.from_id) continue
      counts.set(m.from_id, (counts.get(m.from_id) ?? 0) + 1)
    }
  }

  let best = ''
  let bestCount = 0
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id
      bestCount = count
    }
  }
  if (!best) throw new Error('Could not determine the owner id from the dump.')
  return best
}

/**
 * Chats and people are referred to by a short hash instead of their real name,
 * so the index never carries who the owner talks to. Stable across rebuilds.
 */
export function pseudonym(prefix: string, seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex').slice(0, 6)
  return `${prefix}-${h}`
}

function entitiesOf(raw: RawMessage): TextEntity[] {
  const out: TextEntity[] = []
  for (const e of raw.text_entities ?? []) {
    const text = e?.text ?? ''
    if (text) out.push({ type: e?.type ?? 'plain', text })
  }
  return out
}

function registerOf(chatType: string): 'dm' | 'group' {
  return chatType === 'personal_chat' || chatType === 'saved_messages'
    ? 'dm'
    : 'group'
}

/**
 * Walk the export chat by chat. Yields every message, the owner's and the
 * interlocutors' alike: the latter are needed both as reply context and as the
 * background corpus the lexicon is scored against.
 */
export function* iterateChats(
  dump: RawDump,
  stopList: string[] = []
): Generator<ParsedChat> {
  const blocked = new Set(stopList.map(s => s.toLowerCase()))

  for (const chat of allChats(dump)) {
    const name = chat.name ?? ''
    if (blocked.has(name.toLowerCase())) continue

    const type = chat.type ?? 'unknown'
    const messages: ParsedMessage[] = []

    for (const raw of chat.messages ?? []) {
      if (raw.type !== 'message') continue
      const entities = entitiesOf(raw)
      messages.push({
        id: raw.id ?? 0,
        ts: Number.parseInt(raw.date_unixtime ?? '0', 10) || 0,
        fromId: raw.from_id ?? '',
        from: raw.from ?? '',
        entities,
        text: entities.map(e => e.text).join(''),
        isForwarded: Boolean(raw.forwarded_from || raw.saved_from),
        isViaBot: Boolean(raw.via_bot),
        replyToId: raw.reply_to_message_id ?? null,
      })
    }

    yield {
      id: chat.id ?? 0,
      name,
      type,
      key: pseudonym('chat', `${chat.id ?? 0}:${name}`),
      register: registerOf(type),
      messages,
    }
  }
}
