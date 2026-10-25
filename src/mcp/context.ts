import { existsSync } from 'node:fs'

import type { Config } from '#thinks/config'
import { openDb, type Db } from '#thinks/store/db'
import { loadProfile, type StyleProfile } from '#thinks/style/profile'

/** Everything a tool needs once the corpus exists. */
export type Corpus = {
	db: Db
	profile: StyleProfile
}

const BUILD_HINT = {
	cli:
		'Выгрузи архив Telegram (Settings > Advanced > Export Telegram data, JSON) ' +
		'и запусти:\n\n  thinks-mcp build <путь к result.json>\n\n' +
		'Пересобирать сервер после этого не нужно -- он подхватит корпус сам.',
	hosted:
		'Выгрузи архив Telegram (Settings > Advanced > Export Telegram data, JSON) ' +
		'и загрузи result.json в кабинете. Переподключаться после сборки не нужно.',
}

export type CorpusMode = keyof typeof BUILD_HINT

/** Why there is no corpus, and what to do about it in this mode. */
export function corpusMissing(mode: CorpusMode, dbExists: boolean): string {
	const why = dbExists
		? 'Корпус собран не до конца: в базе нет профиля, похоже, сборка оборвалась.'
		: 'Корпус не собран, поэтому отвечать твоим голосом пока не из чего.'

	return `${why}\n${BUILD_HINT[mode]}`
}

/**
 * Lazy handle on the corpus.
 *
 * The server has to start even when nothing has been built yet: it is wired
 * into a global MCP config, so throwing at startup would leave a dead server in
 * the list on every machine that has not imported an archive. Loading on first
 * use also means that building the corpus while the host is running just works —
 * the next tool call picks it up, no restart.
 */
export class CorpusRef {
	private corpus: Corpus | null = null

	private readonly cfg: Config
	private readonly mode: CorpusMode

	constructor(cfg: Config, mode: CorpusMode = 'cli') {
		this.cfg = cfg
		this.mode = mode
	}

	/** What to tell the user when get() returned null. */
	missing(): string {
		return corpusMissing(this.mode, existsSync(this.cfg.dbPath))
	}

	get(): Corpus | null {
		if (this.corpus) return this.corpus

		if (!existsSync(this.cfg.dbPath)) return null

		const db = openDb(this.cfg.dbPath)
		const profile = loadProfile(db)

		if (!profile) {
			db.close()

			return null
		}

		this.corpus = {
			db,
			profile: { ...profile, neverMarks: this.cfg.neverMarks },
		}

		return this.corpus
	}

	close(): void {
		this.corpus?.db.close()
		this.corpus = null
	}
}

/** Shared dependencies passed to every tool's register function. */
export type ToolContext = {
	cfg: Config
	corpus: CorpusRef
}
