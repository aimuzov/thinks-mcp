import type { Turn } from '../corpus/types.js'

export interface AntiPattern {
  label: string
  /** How many messages out of the corpus contain it. */
  hits: number
  /** Share of messages, in percent. */
  share: number
}

/**
 * Habits a language model reaches for by default. Each is counted against the
 * real corpus rather than asserted: "не пиши канцелярит" is advice a model can
 * argue with, "«однако» встречается 20 раз на 379k сообщений" is not.
 */
/**
 * Word boundaries for Cyrillic. JavaScript's \b only knows ASCII word
 * characters, so /\bоднако\b/ matches nothing at all — a silent failure that
 * reported every clerical probe as zero hits.
 */
export const word = (body: string) =>
  new RegExp(`(?<!\\p{L})(?:${body})(?!\\p{L})`, 'iu')

export interface Probe {
  label: string
  test: RegExp
}

const PROBES: Probe[] = [
  { label: 'однако', test: word('однако') },
  { label: 'таким образом', test: /таким образом/i },
  { label: 'является', test: word('являетс[яь]') },
  { label: 'данный / данная', test: word('данн(?:ый|ая|ое|ые|ого|ой)') },
  { label: 'в рамках', test: /в рамках/i },
  { label: 'в связи с', test: /в связи с/i },
  { label: 'осуществлять', test: /осуществл/i },
  { label: 'следует отметить', test: /(следует|необходимо) отметить/i },
  { label: 'списки через дефис', test: /^\s*[-–—]\s+\S/m },
  { label: 'нумерованные списки', test: /^\s*\d[.)]\s+\S/m },
  { label: 'буллеты •', test: /^\s*•/m },
  { label: 'markdown-жирный **', test: /\*\*/ },
  { label: 'эмодзи 👍', test: /👍/u },
]

/**
 * Marks a model reaches for when it types Russian: the typographic set of a
 * printed book rather than of a chat window.
 *
 * They live apart from PROBES because they are measured per register and
 * checked against their own threshold. A dash at 1% of messages is rare enough
 * to give a text away, yet nowhere near the 0.2% that makes a clerical word
 * count as foreign.
 */
export const FOREIGN_TYPOGRAPHY: Probe[] = [
  { label: 'кавычки-ёлочки «»', test: /[«»]/u },
  { label: 'длинное тире —', test: /—/u },
  { label: 'короткое тире –', test: /–/u },
  { label: 'кавычки-лапки “”', test: /[“”]/u },
]

/**
 * The ASCII stand-in for a dash, measured but never held against a text.
 *
 * A comment is full of double hyphens that are not dashes at all -- CLI flags
 * (`--profile`), SQL comments, rules of `-` across a section -- so the probe
 * takes only a standalone one. Whether it is the author's habit differs by
 * register: in chat it is nobody's, in code it can be how they write a dash.
 */
export const DOUBLE_HYPHEN: Probe = {
  label: 'двойной дефис --',
  test: /(?<![-\p{L}\p{N}/])--(?![-\p{L}\p{N}])/u,
}

export const TYPOGRAPHY: Probe[] = [...FOREIGN_TYPOGRAPHY, DOUBLE_HYPHEN]

/** Below this share of messages a habit counts as "not mine". Percent. */
export const RARE_SHARE = 0.2

/** Below this share a typographic mark counts as foreign. Percent. */
export const TYPO_FOREIGN_SHARE = 2

/** At or above this share the double hyphen counts as the owner's own. */
export const TYPO_OWN_SHARE = 1

const LIST_LABELS = ['списки через дефис', 'нумерованные списки', 'буллеты •']
const MARKDOWN_LABELS = ['markdown-жирный **']

/**
 * Share of messages, in percent, carrying any of the given habits.
 *
 * Undefined when none of them was measured: a profile built before the probe
 * existed must not be read as "never does this".
 */
function habitShare(
  patterns: AntiPattern[],
  labels: string[]
): number | undefined {
  const found = patterns.filter(a => labels.includes(a.label))
  if (!found.length) return undefined
  return Math.max(...found.map(a => a.share))
}

export const listShare = (patterns: AntiPattern[]) =>
  habitShare(patterns, LIST_LABELS)

export const markdownShare = (patterns: AntiPattern[]) =>
  habitShare(patterns, MARKDOWN_LABELS)

/** Share of the given texts, in percent, matching each probe. */
function countProbes(probes: Probe[], texts: string[]): AntiPattern[] {
  const total = texts.length || 1

  return probes
    .map(probe => {
      let hits = 0
      for (const text of texts) if (probe.test.test(text)) hits++
      return {
        label: probe.label,
        hits,
        share: Math.round((hits / total) * 100_000) / 1000,
      }
    })
    .sort((a, b) => a.share - b.share)
}

export function findAntiPatterns(turns: Turn[]): AntiPattern[] {
  return countProbes(
    PROBES,
    turns.flatMap(t => t.parts)
  )
}

/**
 * Measure the typographic marks over a ready list of texts.
 *
 * Takes strings rather than turns because both halves of the corpus need it:
 * chat messages on one side, comment lines on the other.
 */
export function measureTypography(texts: string[]): AntiPattern[] {
  return countProbes(TYPOGRAPHY, texts)
}

/**
 * Measured share of one probe, or undefined when it was never measured.
 *
 * A profile built before the probe existed must not be read as "never does
 * this" -- same reason `habitShare` returns undefined.
 */
export function shareOf(
  patterns: AntiPattern[] | undefined,
  label: string
): number | undefined {
  return patterns?.find(a => a.label === label)?.share
}
