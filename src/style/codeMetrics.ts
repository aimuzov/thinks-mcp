import { measureTypography, word, type AntiPattern } from './antipatterns.js'

/** Sizes measured within one genre. */
export interface GenreSizes {
  blocks: number
  /** Width of a single comment line, in characters. */
  lineWidth: { median: number; p75: number; p90: number; max: number }
  /**
   * How many source lines a block spans.
   *
   * `medianMulti` ignores one-liners. A large share of docblocks are a single
   * line (`/** Что-то. *\/`), which drags the plain median to 1 and tells a
   * model that a docblock is normally one line — the opposite of what it should
   * learn when it has something to explain.
   */
  blockLines: {
    median: number
    medianMulti: number
    p90: number
    oneLiners: number
  }
  /** Share of blocks written in Russian. */
  russian: number
}

export interface CodeMetrics {
  blocks: number
  lines: number
  /**
   * Sizes per genre. An inline note and a docblock differ by construction —
   * 60% of inline comments are one-liners while a docblock opens with a summary
   * line and continues — so a single median would describe neither.
   */
  genres: { code: GenreSizes; jsdoc: GenreSizes }
  inline: number
  doc: number
  /** Share of all blocks written in Russian. */
  russian: number
  markers: { name: string; count: number; share: number }[]
  /** Causal connectives, the thing that makes a comment explain rather than restate. */
  connectives: { phrase: string; count: number; share: number }[]
  /** Blocks per repository, so the profile can show where the corpus came from. */
  repos: { repo: string; blocks: number }[]
  /** Typographic marks per genre, counted over comment lines. */
  typography?: Partial<Record<'code' | 'jsdoc', AntiPattern[]>>
  /**
   * Last year included in the typography count, exclusive. Zero means the whole
   * corpus was counted.
   *
   * Only this measure takes a window, and it takes one because it is the
   * measure a model can corrupt: comments written with an assistant carry its
   * marks, `git blame` still calls them the owner's, and counting them teaches
   * the assistant what the assistant already wrote.
   */
  typographyUntil?: number
}

export interface CodeBlockInput {
  repo: string
  lines: string[]
  text: string
  isDoc: boolean
  lang: 'ru' | 'en'
  /** Year of the commit the block was last written in. */
  year: number
}

/**
 * Fewer handwritten lines than this and the genre goes unmeasured.
 *
 * A window can cut a genre down to a handful of lines, and a mark absent from
 * twenty lines is not a mark the owner avoids. Better no number than a
 * confident zero.
 */
const MIN_TYPOGRAPHY_LINES = 200

/**
 * Marker vocabulary counted per block. Which ones are the author's own is
 * decided by `splitMarkers`.
 */
export const MARKERS = [
  'TODO',
  'HACK',
  'NOTE',
  'REVIEW',
  'FIXME',
  'XXX',
  'WARN',
  'IMPORTANT',
]

/**
 * Markers the author relies on, against the rest of the vocabulary.
 *
 * A marker seen once or twice next to hundreds of another is not a habit — a
 * stray FIXME survives merges — so anything under a tenth of the most used one
 * counts as foreign too.
 */
export function splitMarkers(code: CodeMetrics): {
  own: string[]
  foreign: string[]
} {
  const top = code.markers[0]?.count ?? 0
  const own = code.markers.filter(m => m.count >= top / 10).map(m => m.name)
  const foreign = MARKERS.filter(name => !own.includes(name))
  return { own, foreign }
}

/**
 * Phrases that carry a reason. Their frequency is the closest measurable proxy
 * for the rule the author states outright: a comment must say why, not what.
 */
const CONNECTIVES = [
  'потому что',
  'так как',
  'поэтому',
  'то есть',
  'для того чтобы',
  'дело в том что',
  'иначе',
  'чтобы не',
  'because',
  'so that',
  'otherwise',
]

const percentile = (sorted: number[], p: number) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
    : 0

const round = (n: number, digits = 3) => {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

function sizesOf(blocks: CodeBlockInput[]): GenreSizes {
  const widths: number[] = []
  const spans: number[] = []
  let russian = 0

  for (const block of blocks) {
    for (const line of block.lines) if (line) widths.push(line.length)
    spans.push(block.lines.length)
    if (block.lang === 'ru') russian++
  }

  widths.sort((a, b) => a - b)
  spans.sort((a, b) => a - b)
  const total = blocks.length || 1

  return {
    blocks: blocks.length,
    lineWidth: {
      median: percentile(widths, 0.5),
      p75: percentile(widths, 0.75),
      p90: percentile(widths, 0.9),
      max: widths.at(-1) ?? 0,
    },
    blockLines: {
      median: percentile(spans, 0.5),
      medianMulti: percentile(
        spans.filter(n => n > 1),
        0.5
      ),
      p90: percentile(spans, 0.9),
      oneLiners: round(spans.filter(n => n === 1).length / total),
    },
    russian: round(russian / total),
  }
}

export function measureCode(
  blocks: CodeBlockInput[],
  typographyUntil = 0
): CodeMetrics {
  const total = blocks.length || 1

  let lines = 0
  let doc = 0
  let russian = 0
  const markerCounts = new Map<string, number>()
  const connectiveCounts = new Map<string, number>()
  const repoCounts = new Map<string, number>()

  for (const block of blocks) {
    for (const line of block.lines) if (line) lines++
    if (block.isDoc) doc++
    if (block.lang === 'ru') russian++
    repoCounts.set(block.repo, (repoCounts.get(block.repo) ?? 0) + 1)

    for (const marker of MARKERS) {
      if (new RegExp(`\\b${marker}\\b:?`).test(block.text)) {
        markerCounts.set(marker, (markerCounts.get(marker) ?? 0) + 1)
      }
    }
    const lower = block.text.toLowerCase()
    for (const phrase of CONNECTIVES) {
      const re = /^[a-z ]+$/.test(phrase) ? new RegExp(phrase) : word(phrase)
      if (re.test(lower)) {
        connectiveCounts.set(phrase, (connectiveCounts.get(phrase) ?? 0) + 1)
      }
    }
  }

  const rank = (counts: Map<string, number>) =>
    [...counts.entries()]
      .map(([name, count]) => ({ name, count, share: round(count / total) }))
      .sort((a, b) => b.count - a.count)

  return {
    blocks: blocks.length,
    lines,
    genres: {
      code: sizesOf(blocks.filter(b => !b.isDoc)),
      jsdoc: sizesOf(blocks.filter(b => b.isDoc)),
    },
    inline: blocks.length - doc,
    doc,
    russian: round(russian / total),
    markers: rank(markerCounts),
    connectives: rank(connectiveCounts).map(({ name, count, share }) => ({
      phrase: name,
      count,
      share,
    })),
    repos: [...repoCounts.entries()]
      .map(([repo, blocks]) => ({ repo, blocks }))
      .sort((a, b) => b.blocks - a.blocks),
    typography: typographyOf(blocks, typographyUntil),
    typographyUntil,
  }
}

/** Marks per genre, counted over the handwritten window only. */
function typographyOf(
  blocks: CodeBlockInput[],
  until: number
): CodeMetrics['typography'] {
  const handwritten = until ? blocks.filter(b => b.year < until) : blocks

  const perGenre = (isDoc: boolean) => {
    const lines = handwritten
      .filter(b => b.isDoc === isDoc)
      .flatMap(b => b.lines)
      .filter(Boolean)
    return lines.length >= MIN_TYPOGRAPHY_LINES
      ? measureTypography(lines)
      : undefined
  }

  const code = perGenre(false)
  const jsdoc = perGenre(true)
  return {
    ...(code ? { code } : {}),
    ...(jsdoc ? { jsdoc } : {}),
  }
}
