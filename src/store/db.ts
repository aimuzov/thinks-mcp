import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

/**
 * Corpus schema.
 *
 * Two FTS tables because the tools search two different things: `write` and
 * `rephrase` match against what the owner said, while `reply` matches against
 * what was said *to* them — the incoming/answer pairs are the whole reason
 * replies sound right. Both are contentless tables keyed by turn.id, so message
 * text is stored once, in `turn`.
 *
 * Both indexes hold stemmed text (see search/stem.ts): FTS5's unicode61
 * tokenizer handles Cyrillic but does no morphology, so "сообщение" and
 * "сообщения" would otherwise never match.
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS turn (
     id         INTEGER PRIMARY KEY,
     chat_key   TEXT NOT NULL,
     register   TEXT NOT NULL,
     longform   INTEGER NOT NULL DEFAULT 0,
     holdout    INTEGER NOT NULL DEFAULT 0,
     lang       TEXT,
     ts         INTEGER NOT NULL,
     year       INTEGER NOT NULL,
     parts      TEXT NOT NULL,
     text       TEXT NOT NULL,
     n_parts    INTEGER NOT NULL,
     chars      INTEGER NOT NULL,
     context_in TEXT,
     context_explicit INTEGER NOT NULL DEFAULT 0,
     context_lag INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS turn_register ON turn(register, longform, holdout)`,
  `CREATE INDEX IF NOT EXISTS turn_year ON turn(year)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS turn_fts USING fts5(
     stems, content='', tokenize='unicode61'
   )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS ctx_fts USING fts5(
     stems, content='', tokenize='unicode61'
   )`,
  `CREATE TABLE IF NOT EXISTS profile (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS blame_cache (
     repo     TEXT NOT NULL,
     path     TEXT NOT NULL,
     blob     TEXT NOT NULL,
     comments TEXT NOT NULL,
     PRIMARY KEY (repo, path)
   )`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
]

/** Run a statement that returns nothing. */
export function run(db: Db, sql: string): void {
  db.prepare(sql).run()
}

/**
 * Columns added after the first release. `CREATE TABLE IF NOT EXISTS` leaves an
 * existing table alone, so a database built by an earlier version keeps its old
 * shape until it is patched here — rebuilding a 200k-row corpus just to gain a
 * column is not something a user should have to do.
 */
const ADDED_COLUMNS: { table: string; column: string; type: string }[] = [
  { table: 'turn', column: 'lang', type: 'TEXT' },
  {
    table: 'turn',
    column: 'context_explicit',
    type: 'INTEGER NOT NULL DEFAULT 0',
  },
  { table: 'turn', column: 'context_lag', type: 'INTEGER' },
]

function migrate(db: Db): void {
  for (const { table, column, type } of ADDED_COLUMNS) {
    const columns = db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as unknown as { name: string }[]
    if (columns.some(c => c.name === column)) continue
    run(db, `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }

  // The profile used to live in one row; it is now split into `chat` and
  // `code` so the two build commands cannot overwrite each other. The old row
  // is dead weight — nothing reads it, and rebuilding the chat corpus is a
  // 15-second job that writes the new shape.
  run(db, "DELETE FROM profile WHERE key = 'profile'")
}

export function openDb(path: string): Db {
  const db = new DatabaseSync(path)
  db.prepare('PRAGMA journal_mode = WAL').get()
  for (const stmt of SCHEMA) run(db, stmt)
  migrate(db)
  return db
}

/**
 * Drop the turns of the given registers so a rebuild never mixes two sources.
 *
 * Only those registers: the chat corpus and the code corpus are built by
 * separate commands, and rebuilding one must not silently destroy the other.
 */
export function resetRegisters(db: Db, registers: string[]): void {
  const placeholders = registers.map(() => '?').join(', ')
  db.prepare(`DELETE FROM turn WHERE register IN (${placeholders})`).run(
    ...registers
  )
}

/**
 * Rebuild both FTS indexes from the `turn` table.
 *
 * Contentless FTS5 tables cannot delete a single row without being handed the
 * original text again, so a partial rebuild is not worth the bookkeeping:
 * wiping and re-indexing 200k rows takes a few seconds and cannot drift out of
 * sync with the table it mirrors.
 */
export function rebuildIndexes(db: Db, stems: (text: string) => string): void {
  for (const table of ['turn_fts', 'ctx_fts']) {
    run(db, `INSERT INTO ${table}(${table}) VALUES('delete-all')`)
  }

  const rows = db
    .prepare('SELECT id, text, context_in FROM turn WHERE holdout = 0')
    .all() as unknown as {
    id: number
    text: string
    context_in: string | null
  }[]

  const insertText = db.prepare(
    'INSERT INTO turn_fts (rowid, stems) VALUES (?, ?)'
  )
  const insertContext = db.prepare(
    'INSERT INTO ctx_fts (rowid, stems) VALUES (?, ?)'
  )

  run(db, 'BEGIN')
  try {
    for (const row of rows) {
      insertText.run(row.id, stems(row.text))
      if (row.context_in) insertContext.run(row.id, stems(row.context_in))
    }
    run(db, 'COMMIT')
  } catch (err) {
    run(db, 'ROLLBACK')
    throw err
  }
}

/** Next free turn id, so two corpora can coexist in one table. */
export function nextTurnId(db: Db): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(id), 0) AS max FROM turn')
    .get() as { max: number } | undefined
  return (row?.max ?? 0) + 1
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}
