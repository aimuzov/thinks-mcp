import { reject, hasSubstance, type FilterStats } from './filter.js'
import type { Sanitizer } from './sanitize.js'
import type { ParsedChat, Turn } from './types.js'

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

/**
 * Group a chat's messages into turns.
 *
 * A turn is a run of consecutive owner messages sent within the burst window.
 * This is the unit that matters: a large share of chat messages belong to a run
 * of two or more, so "how they answer" is often several short messages rather
 * than one paragraph. Indexing single messages would quietly teach the opposite.
 */
export function buildTurns(
  chat: ParsedChat,
  san: Sanitizer,
  opts: TurnOptions,
  stats: FilterStats
): Turn[] {
  const turns: Turn[] = []

  let parts: string[] = []
  let startTs = 0
  let lastTs = 0
  let contextIn: string | null = null
  let pendingContext: string | null = null
  let pendingContextTs = 0

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
      contextIn,
    })
    parts = []
    contextIn = null
  }

  for (const m of chat.messages) {
    if (m.fromId !== opts.ownerId) {
      flush()
      // Remember what was just said to us; it becomes the context of whatever
      // the owner says next, provided they answer within a few hours.
      const incoming = san.clean(m.entities)
      if (incoming && hasSubstance(incoming)) {
        pendingContext = incoming.slice(0, CONTEXT_MAX_CHARS)
        pendingContextTs = m.ts
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
      contextIn =
        pendingContext && m.ts - pendingContextTs <= CONTEXT_MAX_AGE_SECONDS
          ? pendingContext
          : null
      // One incoming message is the context of one turn. Without this reset a
      // later, unrelated turn would inherit it and pollute the reply pairs.
      pendingContext = null
    }

    parts.push(cleaned)
    lastTs = m.ts
  }

  flush()
  return turns
}
