import { isCodeRegister, type Register } from '../corpus/types.js'
import { word } from './antipatterns.js'
import { metricsFor, type StyleProfile } from './profile.js'

export interface Finding {
  /** What tripped, in the owner's terms. */
  issue: string
  /** The offending fragment, when there is one. */
  fragment?: string
  /** How far off it is, as a number the caller can act on. */
  detail: string
  penalty: number
}

export interface CheckReport {
  register: Register
  score: number
  verdict: string
  messages: number
  findings: Finding[]
}

const EMOJI_RE = /[\p{Extended_Pictographic}ツ]/gu

const CLERICAL: { label: string; test: RegExp }[] = [
  { label: 'однако', test: word('однако') },
  { label: 'таким образом', test: /таким образом/i },
  { label: 'является', test: word('являетс[яь]') },
  { label: 'данный', test: word('данн(?:ый|ая|ое|ые|ого|ой)') },
  { label: 'в рамках', test: /в рамках/i },
  { label: 'в связи с', test: /в связи с/i },
  { label: 'осуществлять', test: /осуществл/i },
  { label: 'следует отметить', test: /(следует|необходимо) отметить/i },
  { label: 'в целом', test: word('в целом') },
  { label: 'стоит отметить', test: /стоит отметить/i },
]

const truncate = (s: string, n = 60) =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`

/**
 * Score a text against the measured profile.
 *
 * Entirely deterministic — no model involved. That is the point: it gives the
 * calling model something to check itself against that cannot be argued with,
 * and it gives the same answer every time for the same text.
 */
export function checkText(
  text: string,
  profile: StyleProfile,
  register: Register = 'dm',
  code?: string
): CheckReport {
  if (isCodeRegister(register)) {
    return checkComment(text, profile, register as 'code' | 'jsdoc', code)
  }

  const m = metricsFor(profile, register)
  const findings: Finding[] = []

  const messages = text
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)

  if (!m || !m.messages || !messages.length) {
    return {
      register,
      score: 0,
      verdict: 'Проверять нечего.',
      messages: messages.length,
      findings,
    }
  }

  const whole = messages.join('\n')

  // Length, per message and overall.
  for (const msg of messages) {
    if (msg.length > m.messageLength.p90) {
      findings.push({
        issue: 'Сообщение длиннее, чем я обычно пишу',
        fragment: truncate(msg),
        detail: `${msg.length} символов при потолке ${m.messageLength.p90} (медиана ${m.messageLength.median})`,
        penalty: Math.min(
          25,
          5 + Math.floor((msg.length / m.messageLength.p90 - 1) * 20)
        ),
      })
    }
  }
  if (whole.length > m.turnLength.p90) {
    findings.push({
      issue: 'Ответ целиком длиннее обычного',
      detail: `${whole.length} символов при потолке ${m.turnLength.p90}`,
      penalty: 10,
    })
  }

  // A single long paragraph where the archive would have used several messages.
  if (
    register !== 'longform' &&
    messages.length === 1 &&
    whole.length > m.messageLength.p90
  ) {
    findings.push({
      issue: 'Всё слито в одно сообщение',
      detail: `${Math.round(m.bursts.messagesInBursts * 100)}% моих сообщений идут очередью из нескольких коротких`,
      penalty: 10,
    })
  }

  // Punctuation habits.
  const exclamations = messages.filter(s => s.includes('!')).length
  const expectedExcl = m.punctuation.hasExclamation * messages.length
  if (exclamations > Math.max(1, expectedExcl * 3)) {
    findings.push({
      issue: 'Слишком много восклицательных знаков',
      detail: `${exclamations} из ${messages.length} сообщений при обычной доле ${Math.round(m.punctuation.hasExclamation * 1000) / 10}%`,
      penalty: 10,
    })
  }

  const noPeriod = messages.filter(s => /[\p{L}\p{N}]$/u.test(s)).length
  if (m.punctuation.endsPeriod > 0.5 && noPeriod / messages.length > 0.6) {
    findings.push({
      issue: 'Нет точек в конце',
      detail: `я ставлю точку в ${Math.round(m.punctuation.endsPeriod * 100)}% сообщений`,
      penalty: 8,
    })
  }

  const lowercaseStart = messages.filter(s => {
    const first = [...s][0] ?? ''
    return /\p{Ll}/u.test(first)
  }).length
  if (
    m.punctuation.startsCapital > 0.8 &&
    lowercaseStart / messages.length > 0.4
  ) {
    findings.push({
      issue: 'Сообщения начинаются со строчной буквы',
      detail: `я начинаю с заглавной в ${Math.round(m.punctuation.startsCapital * 100)}% случаев`,
      penalty: 8,
    })
  }

  // Emoji outside the palette.
  const palette = new Set(m.emoji.slice(0, 8).map(e => e.char))
  const foreign = new Set(
    [...whole.matchAll(EMOJI_RE)].map(x => x[0]).filter(ch => !palette.has(ch))
  )
  if (foreign.size) {
    findings.push({
      issue: 'Эмодзи не из моей палитры',
      fragment: [...foreign].join(' '),
      detail: `я использую ${[...palette].slice(0, 5).join(' ')}`,
      penalty: 6 * foreign.size,
    })
  }

  // Formatting the archive essentially never uses.
  if (/^\s*([-–—•*]|\d[.)])\s+\S/m.test(whole)) {
    findings.push({
      issue: 'Список — я так не пишу',
      detail: 'списки встречаются в 0.05–0.1% моих сообщений',
      penalty: 15,
    })
  }
  if (/\*\*|__/.test(whole)) {
    findings.push({
      issue: 'Markdown-разметка',
      detail: 'в архиве её доля 0.005%',
      penalty: 12,
    })
  }

  for (const probe of CLERICAL) {
    const match = whole.match(probe.test)
    if (match) {
      findings.push({
        issue: 'Канцелярит',
        fragment: match[0],
        detail: `«${probe.label}» я практически не употребляю`,
        penalty: 10,
      })
    }
  }

  const penalty = findings.reduce((n, f) => n + f.penalty, 0)
  const score = Math.max(0, Math.min(100, 100 - penalty))

  return {
    register,
    score,
    verdict: verdictFor(score),
    messages: messages.length,
    findings: findings.sort((a, b) => b.penalty - a.penalty),
  }
}

/** Markers the author uses, and the ones they replaced long ago. */
const OWN_MARKERS = ['TODO', 'HACK', 'NOTE', 'REVIEW']
const FOREIGN_MARKERS = ['FIXME', 'XXX', 'WARN', 'IMPORTANT']

/**
 * Words a comment and its code share, as a fraction of the comment's own words.
 *
 * Identifiers are split on camelCase and underscores, so `setRetryTimeout`
 * contributes `set`, `retry` and `timeout`.
 *
 * The measure only works when the comment is in the same language as the
 * identifiers. A Russian comment over English code scores ~0 whatever it says —
 * the ratio detects nothing there, it just reports the language barrier. The
 * threshold below was calibrated against a real corpus so that it costs well
 * under 2% of genuine comments in either language.
 */
export function codeOverlap(comment: string, code: string): number {
  const words = (s: string) =>
    new Set(
      (s.match(/[\p{L}]{3,}/gu) ?? [])
        // Split camelCase only at a lower-to-upper boundary. Splitting before
        // every capital shreds DEFAULT_TIMEOUT into single letters, which then
        // fail the length filter and vanish from the comparison entirely.
        .flatMap(w => w.split(/[_-]+|(?<=\p{Ll})(?=\p{Lu})/u))
        .map(w => w.toLowerCase())
        .filter(w => w.length >= 3)
    )

  const own = words(comment)
  const theirs = words(code)
  if (!own.size || !theirs.size) return 0

  let shared = 0
  for (const w of own) if (theirs.has(w)) shared++
  return shared / own.size
}

/** Above this, a comment is restating the code rather than explaining it. */
const RESTATEMENT_THRESHOLD = 0.7

/**
 * Check a comment rather than a chat message.
 *
 * Shares nothing with the chat path on purpose: a comment has no emoji palette
 * and no burst rhythm, but it does have a line width, a fixed marker
 * vocabulary, and one hard rule — it must say why, not restate the code.
 */
function checkComment(
  text: string,
  profile: StyleProfile,
  register: 'code' | 'jsdoc',
  code?: string
): CheckReport {
  const findings: Finding[] = []
  const codeStats = profile.code

  const lines = text
    .split('\n')
    .map(l => l.replace(/^\s*(\/\*\*?|\*\/|\*|\/\/|#|--)\s?/, '').trimEnd())
    .filter(l => l.trim())

  if (!codeStats || !lines.length) {
    return {
      register,
      score: 0,
      verdict: codeStats ? 'Проверять нечего.' : 'Корпус кода не собран.',
      messages: lines.length,
      findings,
    }
  }

  const sizes = codeStats.genres[register]
  const whole = lines.join('\n')

  // The rule the author states outright — "пересказ кода запрещён" — and the
  // only one that needs the code itself to check.
  if (code) {
    const overlap = codeOverlap(whole, code)
    if (overlap > RESTATEMENT_THRESHOLD) {
      findings.push({
        issue: 'Пересказ кода',
        fragment: truncate(whole, 50),
        detail:
          `${Math.round(overlap * 100)}% слов комментария повторяют код рядом — ` +
          'скажи, почему так сделано, а не что тут написано',
        penalty: 30,
      })
    }
  }

  for (const line of lines) {
    if (line.length > sizes.lineWidth.p90) {
      findings.push({
        issue: 'Строка шире, чем я обычно пишу',
        fragment: truncate(line),
        detail: `${line.length} символов при потолке ${sizes.lineWidth.p90} (медиана ${sizes.lineWidth.median})`,
        penalty: 8,
      })
    }
  }

  if (lines.length > sizes.blockLines.p90) {
    findings.push({
      issue: 'Блок длиннее обычного',
      detail: `${lines.length} строк при потолке ${sizes.blockLines.p90}`,
      penalty: 8,
    })
  }

  for (const marker of FOREIGN_MARKERS) {
    if (new RegExp(`\\b${marker}\\b`).test(whole)) {
      findings.push({
        issue: 'Чужой маркер',
        fragment: marker,
        detail: `я использую только ${OWN_MARKERS.join(', ')}`,
        penalty: 12,
      })
    }
  }

  for (const probe of CLERICAL) {
    const match = whole.match(probe.test)
    if (match) {
      findings.push({
        issue: 'Канцелярит',
        fragment: match[0],
        detail: `«${probe.label}» я практически не употребляю`,
        penalty: 10,
      })
    }
  }

  for (const probe of CODE_WATER) {
    const match = whole.match(probe.test)
    if (match) {
      findings.push({
        issue: 'Вода вместо факта',
        fragment: truncate(match[0], 40),
        detail: probe.why,
        penalty: 12,
      })
    }
  }

  const foreignEmoji = [...whole.matchAll(EMOJI_RE)]
  if (foreignEmoji.length) {
    findings.push({
      issue: 'Эмодзи в комментарии',
      fragment: foreignEmoji.map(m => m[0]).join(' '),
      detail: 'в коде их у меня нет',
      penalty: 10,
    })
  }

  if (register === 'jsdoc' && /@(param|returns)\s*\{/.test(whole)) {
    findings.push({
      issue: 'Тип в фигурных скобках',
      detail: 'типы даёт TypeScript, в JSDoc они не дублируются',
      penalty: 12,
    })
  }

  const penalty = findings.reduce((n, f) => n + f.penalty, 0)
  const score = Math.max(0, Math.min(100, 100 - penalty))

  return {
    register,
    score,
    verdict: verdictFor(score),
    messages: lines.length,
    findings: findings.sort((a, b) => b.penalty - a.penalty),
  }
}

/**
 * Phrases that announce a comment without saying anything.
 *
 * `\w` is ASCII-only in JavaScript, so `\w*` never matches a Cyrillic ending
 * and every one of these probes would silently pass. `\p{L}` with the `u` flag
 * is the working equivalent.
 */
const CODE_WATER: { test: RegExp; why: string }[] = [
  {
    test: /эт[аот]\p{L}*\s+(метод|функци\p{L}*|класс|компонент)\s+(отвечает|предназначен)/iu,
    why: 'вода вместо факта — скажи, что именно делает и почему так',
  },
  { test: /важно отметить/iu, why: 'если важно — скажи что именно' },
  { test: /стоит учитывать/iu, why: 'если стоит — скажи что именно' },
  {
    test: /обеспечива\p{L}*\s+надёжност/iu,
    why: 'ничего не значит',
  },
  { test: /^инициализация$/imu, why: 'пересказ имени функции' },
]

function verdictFor(score: number): string {
  if (score >= 85) return 'Похоже на меня.'
  if (score >= 65) return 'В целом похоже, но есть что поправить.'
  if (score >= 40) return 'Узнаётся с трудом — перепиши по замечаниям.'
  return 'Это не мой голос.'
}

/** Render a report as the text the tool returns. */
export function renderCheck(report: CheckReport): string {
  const lines = [
    `Оценка: ${report.score}/100 — ${report.verdict}`,
    `Регистр: ${report.register}, сообщений: ${report.messages}`,
  ]

  if (!report.findings.length) {
    lines.push('', 'Замечаний нет.')
    return lines.join('\n')
  }

  lines.push('', 'Что выдаёт не меня:')
  for (const f of report.findings) {
    const fragment = f.fragment ? ` — «${f.fragment}»` : ''
    lines.push(`- ${f.issue}${fragment}: ${f.detail}`)
  }
  lines.push('', 'Перепиши текст с учётом этих замечаний и проверь ещё раз.')
  return lines.join('\n')
}
