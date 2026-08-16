import type { Db } from '../store/db.js'
import { isCodeRegister, type Register } from '../corpus/types.js'
import { measure, type RegisterMetrics } from './metrics.js'
import type { Marker } from './lexicon.js'
import type { AntiPattern } from './antipatterns.js'
import type { CodeMetrics } from './codeMetrics.js'
import { codeConstraints, renderCodeProfile } from './codeProfile.js'
import { allTurns } from '../search/query.js'

export const CHAT_REGISTERS: Register[] = ['dm', 'group', 'longform']
export const REGISTERS: Register[] = [...CHAT_REGISTERS, 'code', 'jsdoc']

export interface StyleProfile {
  builtAt: string
  /** Measured over the whole archive. */
  registers: Record<string, RegisterMetrics>
  /**
   * Measured over the last few years only — how the owner writes *now*.
   *
   * Over a decade of chat history punctuation, message length and rhythm all
   * shift enough to matter. Constraints handed to a model come from this
   * window, so it imitates the current author rather than an average of every
   * year they have ever written.
   */
  recent: Record<string, RegisterMetrics>
  /** First year included in `recent`. */
  recentFrom: number
  markers: Marker[]
  antiPatterns: AntiPattern[]
  /** Present once the code corpus has been built. */
  code?: CodeMetrics
}

/**
 * The profile is stored in two rows, not one.
 *
 * `thinks-mcp build` and `thinks-mcp code` run independently, and each knows
 * only about its own corpus — the lexicon needs the chat background corpus,
 * the code stats need repositories. Writing one blob would mean whichever ran
 * last erased the other's numbers.
 */
type ProfilePart = 'chat' | 'code'

interface ChatPart {
  builtAt: string
  registers: Record<string, RegisterMetrics>
  recent?: Record<string, RegisterMetrics>
  recentFrom?: number
  markers: Marker[]
  antiPatterns: AntiPattern[]
}

interface CodePart {
  builtAt: string
  registers: Record<string, RegisterMetrics>
  recent?: Record<string, RegisterMetrics>
  recentFrom?: number
  code: CodeMetrics
}

function savePart(db: Db, key: ProfilePart, value: unknown): void {
  db.prepare(
    'INSERT INTO profile (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value))
}

function loadPart<T>(db: Db, key: ProfilePart): T | null {
  const row = db.prepare('SELECT value FROM profile WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? (JSON.parse(row.value) as T) : null
}

export function saveChatProfile(db: Db, part: ChatPart): void {
  savePart(db, 'chat', part)
}

export function saveCodeProfile(db: Db, part: CodePart): void {
  savePart(db, 'code', part)
}

export function loadProfile(db: Db): StyleProfile | null {
  const chat = loadPart<ChatPart>(db, 'chat')
  const code = loadPart<CodePart>(db, 'code')
  if (!chat && !code) return null

  return {
    builtAt: chat?.builtAt ?? code?.builtAt ?? '',
    registers: { ...(chat?.registers ?? {}), ...(code?.registers ?? {}) },
    recent: { ...(chat?.recent ?? {}), ...(code?.recent ?? {}) },
    recentFrom: chat?.recentFrom ?? code?.recentFrom ?? 0,
    markers: chat?.markers ?? [],
    antiPatterns: chat?.antiPatterns ?? [],
    ...(code ? { code: code.code } : {}),
  }
}

/**
 * Metrics to instruct a model with: the recent window when it holds enough
 * material, the whole archive otherwise. A thin window would produce confident
 * numbers measured on a handful of messages, which is worse than an average.
 */
const MIN_RECENT_MESSAGES = 200

export function metricsFor(
  profile: StyleProfile,
  register: Register
): RegisterMetrics | undefined {
  const recent = profile.recent?.[register]
  if (recent && recent.messages >= MIN_RECENT_MESSAGES) return recent
  return profile.registers[register]
}

/** Measure the given registers off the stored corpus. */
export function measureRegisters(
  db: Db,
  registers: Register[] = CHAT_REGISTERS,
  yearFrom?: number
): Record<string, RegisterMetrics> {
  const out: Record<string, RegisterMetrics> = {}
  for (const register of registers) {
    const rows = allTurns(db, { register, yearFrom })
    out[register] = measure(
      rows.map(r => ({
        chatKey: '',
        register: r.register as 'dm' | 'group',
        longform: Boolean(r.longform),
        ts: r.ts,
        year: r.year,
        parts: r.parts,
        text: r.text,
        chars: r.chars,
        contextIn: r.contextIn,
      }))
    )
  }
  return out
}

const pct = (share: number) => `${Math.round(share * 1000) / 10}%`

/**
 * Render the profile as instructions.
 *
 * Everything here is a number taken from the corpus. That is deliberate: a model
 * given "пиши коротко" writes three sentences and considers it short, while a
 * model given "медиана 19 символов, 90% короче 61" has something it can check
 * itself against — and `check_as_me` checks the same numbers back.
 */
export function renderProfile(
  profile: StyleProfile,
  register: Register = 'dm',
  opts: { full?: boolean } = {}
): string {
  if (isCodeRegister(register)) {
    if (!profile.code) {
      return 'Корпус кода не собран. Запусти `thinks-mcp code <пути к репозиториям>`.'
    }
    return renderCodeProfile(profile.code, register as 'code' | 'jsdoc', opts)
  }

  const m = metricsFor(profile, register)
  if (!m || !m.messages) return 'Профиль для этого регистра пуст.'

  const all = profile.registers[register]
  const isRecent = m !== all && profile.recentFrom > 0

  const lines: string[] = []
  const label =
    register === 'dm'
      ? 'личная переписка'
      : register === 'group'
        ? 'групповой чат'
        : 'длинный авторский текст'

  lines.push(`# Как я пишу — ${label}`)
  lines.push('')
  lines.push(
    `Замерено по ${m.turns.toLocaleString('ru')} ходам ` +
      `(${m.messages.toLocaleString('ru')} сообщений)` +
      (isRecent
        ? ` из моего архива с ${profile.recentFrom} года — это то, как я пишу сейчас.`
        : ' из моего архива.')
  )
  if (isRecent && all?.messages) {
    lines.push(
      `За всё время цифры другие (медиана ${all.messageLength.median}, ` +
        `точка в конце ${pct(all.punctuation.endsPeriod)}) — стиль менялся, ` +
        'ориентируйся на свежие.'
    )
  }
  lines.push('')

  lines.push('## Длина')
  lines.push(
    `- Отдельное сообщение: медиана ${m.messageLength.median} символов, ` +
      `четверть короче ${m.messageLength.p25}, 90% короче ${m.messageLength.p90}.`
  )
  lines.push(
    `- Весь ответ целиком: медиана ${m.turnLength.median}, 90% короче ${m.turnLength.p90}.`
  )
  lines.push(
    '- Длиннее p90 — уже не похоже на меня. Это потолок, а не ориентир.'
  )
  lines.push('')

  if (register !== 'longform') {
    lines.push('## Ритм')
    lines.push(
      `- ${pct(m.bursts.messagesInBursts)} моих сообщений идут очередью: ` +
        'мысль разбивается на несколько коротких подряд, а не пакуется в абзац.'
    )
    lines.push(
      `- Ответ из одного сообщения — ${pct(m.bursts.single)}, из двух — ` +
        `${pct(m.bursts.double)}, из трёх — ${pct(m.bursts.triple)}, ` +
        `из четырёх и больше — ${pct(m.bursts.more)}.`
    )
    lines.push('')
  }

  const p = m.punctuation
  lines.push('## Пунктуация и регистр')
  lines.push(`- С заглавной буквы начинаю ${pct(p.startsCapital)} сообщений.`)
  lines.push(
    `- Точка в конце — ${pct(p.endsPeriod)}, знак вопроса — ${pct(p.endsQuestion)}, ` +
      `закрывающая скобка вместо смайла — ${pct(p.endsParen)}, ` +
      `без знака — ${pct(p.endsNothing)}.`
  )
  lines.push(
    `- Восклицательный знак — редкость: ${pct(p.hasExclamation)} сообщений. ` +
      `Многоточие — ${pct(p.hasEllipsis)}, тире в середине фразы — ${pct(p.hasDash)}.`
  )
  lines.push('')

  if (m.emoji.length) {
    lines.push('## Эмодзи')
    const palette = m.emoji.slice(0, 6).map(e => `${e.char} (${e.count})`)
    lines.push(`- Палитра узкая: ${palette.join(', ')}.`)
    lines.push('- Всё, чего нет в этом списке, звучит как чужой человек.')
    lines.push('')
  }

  if (profile.markers.length) {
    lines.push('## Мои слова')
    lines.push(
      '- Отобраны сравнением с тем, как пишут мои собеседники, — это то, ' +
        'что отличает меня, а не то, что часто в русском языке:'
    )
    const words = profile.markers.slice(0, opts.full ? 60 : 30).map(x => x.word)
    lines.push(`  ${words.join(', ')}.`)
    lines.push('')
  }

  const rare = profile.antiPatterns.filter(a => a.share < 0.2).slice(0, 10)
  if (rare.length) {
    lines.push('## Чего я не делаю')
    lines.push('- Практически не встречается в архиве (доля сообщений):')
    for (const a of rare) {
      lines.push(`  - ${a.label} — ${a.share}%`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/** Numeric constraints for the CONSTRAINTS block of a brief. */
export function constraintsOf(
  profile: StyleProfile,
  register: Register
): string[] {
  if (isCodeRegister(register)) {
    return profile.code
      ? codeConstraints(profile.code, register as 'code' | 'jsdoc')
      : []
  }

  const m = metricsFor(profile, register)
  if (!m || !m.messages) return []

  const out = [
    `Каждое сообщение — не длиннее ${m.messageLength.p90} символов ` +
      `(целься в ${m.messageLength.median}).`,
    `Весь ответ — не длиннее ${m.turnLength.p90} символов.`,
  ]

  if (register !== 'longform') {
    out.push(
      `Если мысль не помещается в одно короткое сообщение — разбей на несколько: ` +
        `так сделано в ${pct(m.bursts.messagesInBursts)} случаев.`
    )
  }

  const p = m.punctuation
  out.push(
    `Начинай с заглавной буквы (${pct(p.startsCapital)}) и ставь точку в конце ` +
      `(${pct(p.endsPeriod)}) — даже в коротком ответе.`
  )
  out.push(
    `Восклицательные знаки почти не используй (${pct(p.hasExclamation)} сообщений).`
  )
  if (m.emoji.length) {
    out.push(
      `Эмодзи — только из палитры: ${m.emoji
        .slice(0, 6)
        .map(e => e.char)
        .join(' ')}. ` + 'Чаще всего их нет вовсе.'
    )
  }
  out.push(
    'Без списков, буллетов и markdown-разметки — в архиве их доля меньше 0.2%.'
  )

  // Blind testing against held-out pairs showed the gap: a model reproduces the
  // shape (length, periods, several short messages) but smooths the vocabulary
  // into literary Russian, writing the dictionary form where the archive has a
  // clipped colloquial one. The markers already know those words; without this
  // line nothing tells the model to actually use them.
  const colloquial = profile.markers
    .filter(x => x.word.length >= 3)
    .slice(0, 12)
    .map(x => x.word)
  if (colloquial.length) {
    out.push(
      `Разговорные формы — норма, не выправляй их в литературные: ` +
        `${colloquial.join(', ')}.`
    )
  }

  return out
}
