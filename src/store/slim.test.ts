import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

import { openDb } from './db.ts'

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
})
