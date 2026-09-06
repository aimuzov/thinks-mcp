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

const PROBES: { label: string; test: RegExp }[] = [
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

/** Below this share of messages a habit counts as "not mine". Percent. */
export const RARE_SHARE = 0.2

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

export function findAntiPatterns(turns: Turn[]): AntiPattern[] {
  const messages = turns.flatMap(t => t.parts)
  const total = messages.length || 1

  return PROBES.map(probe => {
    let hits = 0
    for (const m of messages) if (probe.test.test(m)) hits++
    return {
      label: probe.label,
      hits,
      share: Math.round((hits / total) * 100_000) / 1000,
    }
  }).sort((a, b) => a.share - b.share)
}
