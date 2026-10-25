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
 *
 * `parts` is NULL whenever splitting `text` on newlines gives the parts back,
 * which is nearly every turn: storing both doubled the biggest table for
 * nothing. See `storedParts` and `readParts`.
 */
const turnTable = (name: string) =>
	`CREATE TABLE IF NOT EXISTS ${name} (
     id         INTEGER PRIMARY KEY,
     chat_key   TEXT NOT NULL,
     register   TEXT NOT NULL,
     longform   INTEGER NOT NULL DEFAULT 0,
     holdout    INTEGER NOT NULL DEFAULT 0,
     lang       TEXT,
     ts         INTEGER NOT NULL,
     year       INTEGER NOT NULL,
     parts      TEXT,
     text       TEXT NOT NULL,
     n_parts    INTEGER NOT NULL,
     chars      INTEGER NOT NULL,
     context_in TEXT,
     context_explicit INTEGER NOT NULL DEFAULT 0,
     context_lag INTEGER
   )`

const TURN_INDEXES = [
	`CREATE INDEX IF NOT EXISTS turn_register ON turn(register, longform, holdout)`,
	`CREATE INDEX IF NOT EXISTS turn_year ON turn(year)`,
]

const SCHEMA = [
	turnTable('turn'),
	...TURN_INDEXES,
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
		const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]

		if (columns.some((c) => c.name === column)) continue

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

	// Freed pages are only reused, never returned, so without this the file
	// keeps its old size. Runs once, on the first open after the upgrade.
	if (slimTurns(db)) run(db, 'VACUUM')

	return db
}

/** `parts` as stored: null when `readParts` can get them back from `text`. */
export function storedParts(parts: string[], text: string): string | null {
	return splitsBack(parts, text) ? null : JSON.stringify(parts)
}

export function readParts(stored: string | null, text: string): string[] {
	return stored == null ? text.split('\n') : (JSON.parse(stored) as string[])
}

// A part with a line break of its own cannot be told from two parts once
// joined, so only those turns keep `parts`.
function splitsBack(parts: string[], text: string): boolean {
	const lines = text.split('\n')

	return lines.length === parts.length && lines.every((l, i) => l === parts[i])
}

/**
 * Drop the `parts` that corpora built before 0.7 duplicated on every row.
 *
 * SQLite cannot relax NOT NULL in place, so the table is copied. Row ids are
 * kept, and with them the FTS indexes keyed by them. Returns whether anything
 * changed, so the caller knows the file is worth a VACUUM.
 */
function slimTurns(db: Db): boolean {
	const columns = db.prepare('PRAGMA table_info(turn)').all() as unknown as {
		name: string
		notnull: number
	}[]

	if (!columns.find((c) => c.name === 'parts')?.notnull) return false

	db.function('parts_split_back', { deterministic: true }, (parts, text) =>
		splitsBack(JSON.parse(String(parts)) as string[], String(text)) ? 1 : 0,
	)

	const names = columns.map((c) => c.name).join(', ')

	run(db, 'BEGIN')

	try {
		run(db, turnTable('turn_slim'))
		run(db, `INSERT INTO turn_slim (${names}) SELECT ${names} FROM turn`)
		run(db, 'DROP TABLE turn')
		run(db, 'ALTER TABLE turn_slim RENAME TO turn')

		for (const stmt of TURN_INDEXES) run(db, stmt)

		run(db, 'UPDATE turn SET parts = NULL WHERE parts_split_back(parts, text)')
		run(db, 'COMMIT')
	} catch (err) {
		run(db, 'ROLLBACK')

		throw err
	}

	return true
}

/**
 * Write a copy of the corpus to `dest` for serving from another machine.
 *
 * The blame cache stays behind: it only saves `git blame` time on the next
 * `thinks-mcp code`, which never runs on a server, and it takes about a tenth
 * of the file. `dest` must not exist yet.
 */
export function exportForServer(db: Db, dest: string): void {
	db.prepare('VACUUM INTO ?').run(dest)

	const out = new DatabaseSync(dest)

	try {
		run(out, 'DELETE FROM blame_cache')
		run(out, 'VACUUM')
	} finally {
		out.close()
	}
}

/**
 * Drop the turns of the given registers so a rebuild never mixes two sources.
 *
 * Only those registers: the chat corpus and the code corpus are built by
 * separate commands, and rebuilding one must not silently destroy the other.
 */
export function resetRegisters(db: Db, registers: string[]): void {
	const placeholders = registers.map(() => '?').join(', ')

	db.prepare(`DELETE FROM turn WHERE register IN (${placeholders})`).run(...registers)
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

	const rows = db.prepare('SELECT id, text, context_in FROM turn WHERE holdout = 0').all() as unknown as {
		id: number
		text: string
		context_in: string | null
	}[]

	const insertText = db.prepare('INSERT INTO turn_fts (rowid, stems) VALUES (?, ?)')
	const insertContext = db.prepare('INSERT INTO ctx_fts (rowid, stems) VALUES (?, ?)')

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
	const row = db.prepare('SELECT COALESCE(MAX(id), 0) AS max FROM turn').get() as { max: number } | undefined

	return (row?.max ?? 0) + 1
}

export function setMeta(db: Db, key: string, value: string): void {
	db.prepare(
		'INSERT INTO meta (key, value) VALUES (?, ?) ' + 'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
	).run(key, value)
}

export function getMeta(db: Db, key: string): string | null {
	const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined

	return row?.value ?? null
}
