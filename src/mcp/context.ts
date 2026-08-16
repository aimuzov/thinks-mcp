import { existsSync } from 'node:fs'
import type { Config } from '../config.js'
import { openDb, type Db } from '../store/db.js'
import { loadProfile, type StyleProfile } from '../style/profile.js'

/** Everything a tool needs once the corpus exists. */
export interface Corpus {
  db: Db
  profile: StyleProfile
}

export const CORPUS_MISSING =
  'Корпус не собран, поэтому отвечать твоим голосом пока не из чего.\n' +
  'Выгрузи архив Telegram (Settings → Advanced → Export Telegram data, JSON) ' +
  'и запусти:\n\n  thinks-mcp build <путь к result.json>\n\n' +
  'Пересобирать сервер после этого не нужно — он подхватит корпус сам.'

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

  constructor(private readonly cfg: Config) {}

  get(): Corpus | null {
    if (this.corpus) return this.corpus
    if (!existsSync(this.cfg.dbPath)) return null

    const db = openDb(this.cfg.dbPath)
    const profile = loadProfile(db)
    if (!profile) {
      db.close()
      return null
    }

    this.corpus = { db, profile }
    return this.corpus
  }

  close(): void {
    this.corpus?.db.close()
    this.corpus = null
  }
}

/** Shared dependencies passed to every tool's register function. */
export interface ToolContext {
  cfg: Config
  corpus: CorpusRef
}
