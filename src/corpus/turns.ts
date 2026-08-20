import { reject, hasSubstance, type FilterStats } from './filter.js'
import type { Sanitizer } from './sanitize.js'
import type { ParsedChat, ParsedMessage, Turn } from './types.js'

export interface TurnOptions {
  ownerId: string
  burstWindowSeconds: number
  longformMinChars: number
}

/** Beyond this a "burst" is really a monologue; split it into separate turns. */
const MAX_PARTS = 10

/** How stale an incoming message may be and still count as what a turn answers. */
const CONTEXT_MAX_AGE_SECONDS = 6 * 3600

/** Reply context is an excerpt, not a transcript. */
const CONTEXT_MAX_CHARS = 400

interface PendingContext {
  text: string
  ts: number
  /** The author quoted this message explicitly, rather than us guessing. */
  explicit: boolean
}

/**
 * Group a chat's messages into turns.
 *
 * A turn is a run of consecutive owner messages sent within the burst window,
 * because "how they answer" is often several short messages rather than one
 * paragraph. Indexing single messages would quietly teach the opposite.
 *
 * Context comes from one of two places, and the difference matters. With
 * `reply_to_message_id` the pairing is a fact. Without it we guess "whatever
 * was said last", and that guess fails where chat is most ordinary: someone
 * writes "Извини", the author answers about something else, and the pair
 * teaches a model to reply off-topic. Both are kept, both are labelled.
 */
export function buildTurns(
  chat: ParsedChat,
  san: Sanitizer,
  opts: TurnOptions,
  stats: FilterStats
): Turn[] {
  const turns: Turn[] = []
  const byId = new Map<number, ParsedMessage>()
  for (const m of chat.messages) byId.set(m.id, m)

  let parts: string[] = []
  let startTs = 0
  let lastTs = 0
  let context: PendingContext | null = null
  let pending: PendingContext | null = null

  const flush = () => {
    if (!parts.length) return
    const text = parts.join('\n')
    const chars = text.length
    turns.push({
      chatKey: chat.key,
      register: chat.register,
      longform: chars >= opts.longformMinChars,
      ts: startTs,
      year: new Date(startTs * 1000).getUTCFullYear(),
      parts,
      text,
      chars,
      contextIn: context?.text ?? null,
      contextExplicit: context?.explicit ?? false,
      contextLag: context ? Math.max(0, startTs - context.ts) : null,
    })
    parts = []
    context = null
  }

  /** The message this one quotes, if it is someone else's and has text. */
  const quoted = (m: ParsedMessage): PendingContext | null => {
    if (!m.replyToId) return null
    const target = byId.get(m.replyToId)
    if (!target || target.fromId === opts.ownerId) return null

    const text = san.clean(target.entities)
    if (!text || !hasSubstance(text)) return null
    return {
      text: text.slice(0, CONTEXT_MAX_CHARS),
      ts: target.ts,
      explicit: true,
    }
  }

  for (const m of chat.messages) {
    if (m.fromId !== opts.ownerId) {
      flush()
      // Remember what was just said to us; it becomes the context of whatever
      // the owner says next, provided they answer within a few hours.
      const incoming = san.clean(m.entities)
      if (incoming && hasSubstance(incoming)) {
        pending = {
          text: incoming.slice(0, CONTEXT_MAX_CHARS),
          ts: m.ts,
          explicit: false,
        }
      }
      stats['not-owner']++
      continue
    }

    const reason = reject(m, opts.ownerId)
    if (reason) {
      // A forward or a photo in the middle of a burst interrupts the text but
      // not the thought — skip it without breaking the run.
      stats[reason]++
      lastTs = m.ts
      continue
    }

    const cleaned = san.clean(m.entities)
    if (!cleaned || !hasSubstance(cleaned)) {
      stats.empty++
      lastTs = m.ts
      continue
    }
    stats.kept++

    const continues =
      parts.length > 0 &&
      parts.length < MAX_PARTS &&
      m.ts - lastTs <= opts.burstWindowSeconds

    if (!continues) {
      flush()
      startTs = m.ts

      const fresh =
        pending && m.ts - pending.ts <= CONTEXT_MAX_AGE_SECONDS ? pending : null
      // An explicit quote beats the guess even when the guess is more recent.
      context = quoted(m) ?? fresh
      // One incoming message is the context of one turn. Without this reset a
      // later, unrelated turn would inherit it and pollute the reply pairs.
      pending = null
    }

    parts.push(cleaned)
    lastTs = m.ts
  }

  flush()
  return turns
}
