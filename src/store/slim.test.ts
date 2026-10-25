import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'

import type { Config } from '#thinks/config'
import { buildCorpus } from '#thinks/corpus/build'
import type { Corpus } from '#thinks/mcp/context'
import { buildRephraseBrief } from '#thinks/mcp/tools/rephrase-as-me'
import { buildReplyBrief } from '#thinks/mcp/tools/reply-as-me'
import { buildWriteBrief } from '#thinks/mcp/tools/write-as-me'
import { checkText, renderCheck } from '#thinks/style/check'
import { loadProfile } from '#thinks/style/profile'
import { makeDump } from '#thinks/testing/fixtures'

import { exportForServer, openDb, run } from './db.ts'

/** The fixture dump plus a message with line breaks inside a single part. */
function dumpWithMultiline() {
	const dump = makeDump()
	const chat = dump.chats.list[0]!
	const last = chat.messages.at(-1)!
	const text = 'Список на завтра:\nхлеб\nмолоко'

	chat.messages.push({
		...last,
		id: 1000,
		date_unixtime: String(Number(last.date_unixtime) + 5000),
		text,
		text_entities: [{ type: 'plain', text }],
		reply_to_message_id: undefined,
	})

	return dump
}

export function build(): Config {
	const dir = mkdtempSync(join(tmpdir(), 'thinks-slim-'))
	const dumpPath = join(dir, 'dump.json')

	writeFileSync(dumpPath, JSON.stringify(dumpWithMultiline()), 'utf8')

	const cfg: Config = {
		dumpPath,
		dataDir: dir,
		dbPath: join(dir, 'style.db'),
		ownerId: '',
		chatStopList: [],
		burstWindowSeconds: 90,
		longformMinChars: 300,
		holdoutSize: 0,
		codeEmails: [],
		recentYears: 3,
		codeHandwrittenUntil: 0,
		neverMarks: [],
		voice: false,
	}

	buildCorpus(cfg)

	return cfg
}

export function corpusAt(path: string): Corpus {
	const db = openDb(path)

	return { db, profile: loadProfile(db)! }
}

/**
 * Every brief, with lines sorted: the tiny fixture leaves the random fallback
 * sample to fill most slots, so which rows appear is fixed but their order is
 * not.
 */
export function briefs(corpus: Corpus): string[] {
	const out = [
		buildWriteBrief(corpus, { brief: 'напиши, что задержусь' }),
		buildWriteBrief(corpus, { brief: 'список покупок' }),
		buildWriteBrief(corpus, { brief: 'про сантехника', register: 'group' }),
		buildReplyBrief(corpus, { incoming: 'Ты когда освободишься?' }),
		buildReplyBrief(corpus, { incoming: 'А что с доставкой?' }),
		buildRephraseBrief(corpus, { text: 'Я немного задержусь, извини.' }),
		renderCheck(checkText('Однако следует отметить:\n- первое\n- второе', corpus.profile)),
		renderCheck(checkText('Через час.\nМожет раньше.', corpus.profile)),
	]

	return out.map((b) => b.split('\n').sort().join('\n'))
}

describe('corpus storage', () => {
	it('produces the briefs it produced before the schema changed', (t) => {
		const corpus = corpusAt(build().dbPath)

		t.assert.snapshot(briefs(corpus))
		corpus.db.close()
	})

	it('serves a migrated old corpus exactly like a fresh one', () => {
		const fresh = corpusAt(build().dbPath)
		const expected = briefs(fresh)
		const expectedParts = storedPartsOf(fresh.db)

		fresh.db.close()

		const path = build().dbPath

		toLegacy(path)

		const migrated = corpusAt(path)

		assert.deepEqual(briefs(migrated), expected)
		assert.deepEqual(storedPartsOf(migrated.db), expectedParts)
		migrated.db.close()
	})

	it('keeps parts only where the text cannot give them back', () => {
		const db = openDb(build().dbPath)
		const kept = storedPartsOf(db).filter((p) => p != null)

		assert.deepEqual(kept, [JSON.stringify(['Список на завтра:\nхлеб\nмолоко'])])
		db.close()
	})

	it('exports a copy without the blame cache', () => {
		const cfg = build()
		const db = openDb(cfg.dbPath)

		run(db, "INSERT INTO blame_cache VALUES ('repo', 'a.ts', 'blob', '[]')")

		const dest = join(cfg.dataDir, 'server.db')

		exportForServer(db, dest)

		const out = openDb(dest)
		const count = (d: DatabaseSync, sql: string) => (d.prepare(sql).get() as { n: number }).n

		assert.equal(count(out, 'SELECT COUNT(*) AS n FROM blame_cache'), 0)
		assert.equal(count(out, 'SELECT COUNT(*) AS n FROM turn'), count(db, 'SELECT COUNT(*) AS n FROM turn'))
		assert.equal(count(db, 'SELECT COUNT(*) AS n FROM blame_cache'), 1)
		assert.throws(() => exportForServer(db, dest))
		out.close()
		db.close()
	})
})

/** `turn` as corpora before 0.7 had it, with `parts` stored on every row. */
const LEGACY_TURN = `CREATE TABLE turn_legacy (
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
)`

const COLUMNS =
	'id, chat_key, register, longform, holdout, lang, ts, year, parts, text, ' +
	'n_parts, chars, context_in, context_explicit, context_lag'

/** Rewrite a corpus into the old shape, as a user upgrading would have it. */
function toLegacy(path: string): void {
	const db = new DatabaseSync(path)
	const rows = db.prepare('SELECT id, parts, text FROM turn').all() as {
		id: number
		parts: string | null
		text: string
	}[]

	run(db, 'BEGIN')
	run(db, LEGACY_TURN)
	run(db, `INSERT INTO turn_legacy (${COLUMNS}) SELECT ${COLUMNS.replace('parts', "COALESCE(parts, '')")} FROM turn`)

	const fill = db.prepare('UPDATE turn_legacy SET parts = ? WHERE id = ?')

	for (const r of rows) fill.run(r.parts ?? JSON.stringify(r.text.split('\n')), r.id)

	run(db, 'DROP TABLE turn')
	run(db, 'ALTER TABLE turn_legacy RENAME TO turn')
	run(db, 'COMMIT')
	db.close()
}

const storedPartsOf = (db: DatabaseSync) =>
	(db.prepare('SELECT parts FROM turn ORDER BY id').all() as { parts: string | null }[]).map((r) => r.parts)
