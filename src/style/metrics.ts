import type { Turn } from '../corpus/types.js'

export interface LengthStats {
  count: number
  mean: number
  p25: number
  median: number
  p75: number
  p90: number
  max: number
}

export interface PunctuationStats {
  /** Share of messages starting with a capital letter. */
  startsCapital: number
  /** Share of messages ending in each of these. */
  endsPeriod: number
  endsQuestion: number
  endsExclamation: number
  endsParen: number
  endsNothing: number
  /** Share of messages containing these anywhere. */
  hasQuestion: number
  hasExclamation: number
  hasEllipsis: number
  hasDash: number
}

export interface BurstStats {
  /** Share of turns made of exactly 1, 2, 3, 4+ messages. */
  single: number
  double: number
  triple: number
  more: number
  /** Share of individual messages that belong to a multi-message turn. */
  messagesInBursts: number
  meanParts: number
}

export interface RegisterMetrics {
  turns: number
  messages: number
  messageLength: LengthStats
  turnLength: LengthStats
  punctuation: PunctuationStats
  bursts: BurstStats
  emoji: { char: string; count: number }[]
}

// Extended_Pictographic covers the emoji proper; ツ is a katakana character
// commonly used as one in Russian chats and would otherwise be missed.
const EMOJI_RE = /[\p{Extended_Pictographic}ツ]/gu

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[i]
}

function lengths(values: number[]): LengthStats {
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    count: sorted.length,
    mean: sorted.length ? round(sum / sorted.length, 1) : 0,
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    max: sorted.at(-1) ?? 0,
  }
}

const round = (n: number, digits = 3) => {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

/**
 * Measure one register.
 *
 * Punctuation is measured per message rather than per turn: what an
 * interlocutor sees is individual messages, and it is the message-level habits
 * (a period at the end of a four-word reply, a closing paren instead of a
 * smiley) that make a text recognisable.
 */
export function measure(turns: Turn[]): RegisterMetrics {
  const messages = turns.flatMap(t => t.parts)
  const total = messages.length || 1

  let startsCapital = 0
  let alphaStart = 0
  const ends = { period: 0, question: 0, exclamation: 0, paren: 0, nothing: 0 }
  let hasQuestion = 0
  let hasExclamation = 0
  let hasEllipsis = 0
  let hasDash = 0
  const emoji = new Map<string, number>()

  for (const m of messages) {
    const first = [...m][0] ?? ''
    if (/\p{L}/u.test(first)) {
      alphaStart++
      if (first === first.toUpperCase() && first !== first.toLowerCase()) {
        startsCapital++
      }
    }

    const last = m.at(-1) ?? ''
    if (last === '.') ends.period++
    else if (last === '?') ends.question++
    else if (last === '!') ends.exclamation++
    else if (last === ')') ends.paren++
    else ends.nothing++

    if (m.includes('?')) hasQuestion++
    if (m.includes('!')) hasExclamation++
    if (m.includes('...') || m.includes('…')) hasEllipsis++
    if (/\s—\s/.test(m)) hasDash++

    for (const match of m.matchAll(EMOJI_RE)) {
      const ch = match[0]
      emoji.set(ch, (emoji.get(ch) ?? 0) + 1)
    }
  }

  const partCounts = turns.map(t => t.parts.length)
  const share = (n: number, of: number) => round(n / (of || 1))

  return {
    turns: turns.length,
    messages: messages.length,
    messageLength: lengths(messages.map(m => m.length)),
    turnLength: lengths(turns.map(t => t.chars)),
    punctuation: {
      startsCapital: share(startsCapital, alphaStart),
      endsPeriod: share(ends.period, total),
      endsQuestion: share(ends.question, total),
      endsExclamation: share(ends.exclamation, total),
      endsParen: share(ends.paren, total),
      endsNothing: share(ends.nothing, total),
      hasQuestion: share(hasQuestion, total),
      hasExclamation: share(hasExclamation, total),
      hasEllipsis: share(hasEllipsis, total),
      hasDash: share(hasDash, total),
    },
    bursts: burstStats(partCounts),
    emoji: [...emoji.entries()]
      .map(([char, count]) => ({ char, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15),
  }
}

function burstStats(partCounts: number[]): BurstStats {
  const turns = partCounts.length || 1
  const messages = partCounts.reduce((a, b) => a + b, 0) || 1
  const count = (pred: (n: number) => boolean) => partCounts.filter(pred).length

  return {
    single: round(count(n => n === 1) / turns),
    double: round(count(n => n === 2) / turns),
    triple: round(count(n => n === 3) / turns),
    more: round(count(n => n >= 4) / turns),
    messagesInBursts: round(
      partCounts.filter(n => n > 1).reduce((a, b) => a + b, 0) / messages
    ),
    meanParts: round(messages / turns, 2),
  }
}
