import type { Db } from '../store/db.js'
import type { Register } from '../corpus/types.js'
import { tokenize } from './stem.js'

export interface TurnRow {
  id: number
  register: string
  longform: number
  /** Chat pseudonym, or repository name for code registers. */
  chatKey: string
  lang: string | null
  ts: number
  year: number
  parts: string[]
  text: string
  chars: number
  contextIn: string | null
  /** True when the author quoted that message, false when we inferred it. */
  contextExplicit: boolean
  /** BM25 score; absent for randomly sampled fallback rows. */
  score?: number
}

export interface SearchOptions {
  register?: Register
  /** Only meaningful for code registers, where both languages are used. */
  lang?: 'ru' | 'en'
  limit?: number
  yearFrom?: number
  /** Match against what was said *to* the owner instead of what they said. */
  matchContext?: boolean
  /** Only turns that answer something. */
  requireContext?: boolean
  minChars?: number
  maxChars?: number
  /** BM25 units subtracted per year of age. 0 disables the recency weighting. */
  agePenalty?: number
  /** Reference year for that penalty; defaults to the current one. */
  now?: number
}

/**
 * Function words carry no topic and would drag in thousands of irrelevant
 * turns. BM25 already discounts them, but on a 400k-row index the OR query
 * itself gets slow, so they are dropped before the query is built. Stored
 * stemmed, since that is what the index holds.
 */
const STOP_WORDS = new Set(
  tokenize(
    'не в на что это как то у ты да но так ну по же за вот если или к мне ' +
      'он все для из бы мы они его ее там уже еще тут когда до от чтобы был ' +
      'быть есть меня тебя себя очень просто может можно надо тоже сейчас ' +
      'потом раз без она мной тебе ему ей их наш ваш этот тот сам весь'
  )
)

const MAX_QUERY_TOKENS = 16

/**
 * How much a year of age costs a result, in BM25 units.
 *
 * Calibrated against a real archive, where the average BM25 spread across a
 * top-18 result set was ~3.5: at 0.12 a decade of age is worth about a third of
 * that — enough to break ties toward recent writing without letting an
 * irrelevant new message outrank a relevant old one. It matters because writing
 * habits drift, while an unweighted search draws its examples from wherever the
 * archive happens to be densest, which is usually years ago.
 */
const DEFAULT_AGE_PENALTY = 0.12

/**
 * What an inferred pair costs against a quoted one, in the same BM25 units.
 *
 * A quoted reply is a fact — the author picked that message to answer. An
 * inferred one is "whatever was said last", and it is wrong often enough to
 * matter. At 1.5 against a typical spread of ~3.5 a quoted pair wins whenever
 * the two are comparably relevant, while a clearly better inferred match still
 * gets through; the archive holds far more inferred pairs than quoted ones, so
 * excluding them outright would empty most briefs.
 */
const INFERRED_PAIR_PENALTY = 1.5

/** Extra cost for an inferred pair the author took their time over. */
const SLOW_REPLY_PENALTY = 0.8
const SLOW_REPLY_SECONDS = 30 * 60

/** Build an FTS5 OR-query out of free text. Returns null if nothing is left. */
export function buildMatch(text: string): string | null {
  const seen = new Set<string>()
  const tokens: string[] = []

  for (const token of tokenize(text)) {
    if (STOP_WORDS.has(token) || seen.has(token)) continue
    seen.add(token)
    tokens.push(token)
  }
  if (!tokens.length) return null

  // Longer stems are the more contentful ones; keep those when trimming.
  const chosen = tokens
    .slice()
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_QUERY_TOKENS)

  return chosen.map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ')
}

function filters(opts: SearchOptions): { sql: string; params: unknown[] } {
  const clauses: string[] = ['t.holdout = 0']
  const params: unknown[] = []

  if (opts.register === 'longform') {
    clauses.push('t.longform = 1')
  } else if (opts.register) {
    clauses.push('t.register = ?')
    params.push(opts.register)
  }
  if (opts.lang) {
    clauses.push('t.lang = ?')
    params.push(opts.lang)
  }
  if (opts.requireContext)
    clauses.push("t.context_in IS NOT NULL AND t.context_in <> ''")
  if (opts.yearFrom != null) {
    clauses.push('t.year >= ?')
    params.push(opts.yearFrom)
  }
  if (opts.minChars != null) {
    clauses.push('t.chars >= ?')
    params.push(opts.minChars)
  }
  if (opts.maxChars != null) {
    clauses.push('t.chars <= ?')
    params.push(opts.maxChars)
  }

  return { sql: clauses.join(' AND '), params }
}

interface RawRow {
  id: number
  register: string
  longform: number
  chat_key: string
  lang: string | null
  ts: number
  year: number
  parts: string
  text: string
  chars: number
  context_in: string | null
  context_explicit: number
  score?: number
}

/** node:sqlite types rows as Record<string, SQLOutputValue>; the SQL fixes the shape. */
const asRows = (rows: unknown): RawRow[] => rows as RawRow[]

const toRow = (r: RawRow): TurnRow => ({
  id: r.id,
  register: r.register,
  longform: r.longform,
  chatKey: r.chat_key,
  lang: r.lang,
  ts: r.ts,
  year: r.year,
  parts: JSON.parse(r.parts) as string[],
  text: r.text,
  chars: r.chars,
  contextIn: r.context_in,
  contextExplicit: r.context_explicit === 1,
  ...(r.score == null ? {} : { score: Math.round(r.score * 1000) / 1000 }),
})

const COLUMNS =
  't.id, t.register, t.longform, t.chat_key, t.lang, t.ts, t.year, ' +
  't.parts, t.text, t.chars, t.context_in, t.context_explicit'

/**
 * Rank turns against free text with BM25.
 *
 * Always returns something: when the query has no usable tokens, or matches
 * nothing, it falls back to a random sample of the same register. An empty
 * brief would leave the calling model with a style description and no evidence,
 * which is exactly the case where it reverts to its own voice.
 */
export function searchTurns(
  db: Db,
  query: string,
  opts: SearchOptions = {}
): TurnRow[] {
  const limit = opts.limit ?? 20
  const table = opts.matchContext ? 'ctx_fts' : 'turn_fts'
  const match = buildMatch(query)
  const { sql: where, params } = filters(opts)

  const collector = new Collector(limit)

  if (match) {
    const penalty = opts.agePenalty ?? DEFAULT_AGE_PENALTY
    const now = opts.now ?? new Date().getUTCFullYear()

    // Lower is better for bm25, so every penalty is added, not subtracted.
    // Pair confidence only applies when searching what was said *to* the owner;
    // for their own turns there is no pair to be confident about.
    const confidence = opts.matchContext
      ? `+ (CASE WHEN t.context_explicit = 1 THEN 0 ELSE ${INFERRED_PAIR_PENALTY} END)
         + (CASE WHEN t.context_explicit = 0 AND t.context_lag > ${SLOW_REPLY_SECONDS}
                 THEN ${SLOW_REPLY_PENALTY} ELSE 0 END)`
      : ''

    const statement = db.prepare(
      `SELECT ${COLUMNS}, bm25(${table}) AS score,
              bm25(${table}) + ? * MAX(0, ? - t.year) ${confidence} AS rank
         FROM ${table}
         JOIN turn t ON t.id = ${table}.rowid
        WHERE ${table} MATCH ? AND ${where}
        ORDER BY rank
        LIMIT ?`
    )
    collector.add(
      asRows(
        statement.all(penalty, now, match, ...(params as never[]), limit * 3)
      ).map(toRow)
    )
  }

  // Deduplication happens across both sources, not within each: otherwise a
  // sampled "ок" lands next to a matched "Ок." and the brief wastes a slot.
  if (!collector.full) collector.add(sampleTurns(db, opts, limit * 2))

  return collector.rows
}

/** Accumulates results up to a limit, collapsing near-duplicates as it goes. */
class Collector {
  readonly rows: TurnRow[] = []
  private readonly seen = new Set<string>()

  constructor(private readonly limit: number) {}

  get full(): boolean {
    return this.rows.length >= this.limit
  }

  add(candidates: TurnRow[]): void {
    for (const row of candidates) {
      if (this.full) return
      const key = normalizeKey(row.text)
      if (this.seen.has(key)) continue
      this.seen.add(key)
      this.rows.push(row)
    }
  }
}

/** A random sample of a register — the fallback, and the base of a profile. */
export function sampleTurns(
  db: Db,
  opts: SearchOptions = {},
  limit = 20
): TurnRow[] {
  const { sql: where, params } = filters(opts)
  const statement = db.prepare(
    `SELECT ${COLUMNS} FROM turn t WHERE ${where} ORDER BY RANDOM() LIMIT ?`
  )
  return dedupe(asRows(statement.all(...(params as never[]), limit)).map(toRow))
}

/** Read every turn of a register, for profile building. */
export function allTurns(db: Db, opts: SearchOptions = {}): TurnRow[] {
  const { sql: where, params } = filters(opts)
  const statement = db.prepare(`SELECT ${COLUMNS} FROM turn t WHERE ${where}`)
  return asRows(statement.all(...(params as never[]))).map(toRow)
}

export function getTurn(db: Db, id: number): TurnRow | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM turn t WHERE t.id = ?`).get(id)
  return row ? toRow(asRows([row])[0]) : null
}

export interface PairStats {
  turns: number
  pairs: number
  quoted: number
  /** Share of turns that answer something at all. */
  share: number
}

/**
 * How much reply material a register actually holds.
 *
 * Worth asking before trusting a result set: a Telegram export of a supergroup
 * carries almost none of the other participants' messages, so `group` ends up
 * with pairs in the low tens against thousands of turns. A search still returns
 * a few of them and looks perfectly healthy.
 */
export function pairStats(db: Db, register: Register = 'dm'): PairStats {
  const { sql: where, params } = filters({ register })
  const row = db
    .prepare(
      `SELECT COUNT(*) AS turns,
              SUM(CASE WHEN t.context_in IS NOT NULL THEN 1 ELSE 0 END) AS pairs,
              SUM(t.context_explicit) AS quoted
         FROM turn t WHERE ${where}`
    )
    .get(...(params as never[])) as
    | { turns: number; pairs: number | null; quoted: number | null }
    | undefined

  const turns = row?.turns ?? 0
  const pairs = row?.pairs ?? 0
  return {
    turns,
    pairs,
    quoted: row?.quoted ?? 0,
    share: turns ? pairs / turns : 0,
  }
}

/** Turns held out of the index, for the blind acceptance test. */
export function holdoutTurns(db: Db, limit = 20): TurnRow[] {
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM turn t WHERE t.holdout = 1 ORDER BY t.id LIMIT ?`
    )
    .all(limit) as unknown as RawRow[]
  return rows.map(toRow)
}

/**
 * Collapse near-duplicates. Short acknowledgements repeat by the thousand
 * ("Ок.", "ок", "Ага"), and a brief filled with fifteen of them shows the model
 * nothing it did not already know from the first one.
 */
function dedupe(rows: TurnRow[]): TurnRow[] {
  const seen = new Set<string>()
  const out: TurnRow[] = []
  for (const row of rows) {
    const key = normalizeKey(row.text)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

const normalizeKey = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
