import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Config {
  /** Telegram export to build the corpus from. */
  dumpPath: string
  /** Directory holding the built index. */
  dataDir: string
  /** SQLite file with the corpus, the FTS indexes and the style profile. */
  dbPath: string
  /**
   * Telegram user id of the corpus owner, e.g. `user1340580`. Empty means
   * "detect from the dump" — see resolveOwnerId in corpus/parse.ts.
   */
  ownerId: string
  /** Chats excluded from the corpus entirely, matched against the chat name. */
  chatStopList: string[]
  /** Consecutive messages closer than this are one turn. */
  burstWindowSeconds: number
  /** Turns at or above this length also land in the `longform` register. */
  longformMinChars: number
  /** Pairs held out of the index for the blind acceptance test. */
  holdoutSize: number
  /** Git author emails that count as the owner when scanning repositories. */
  codeEmails: string[]
  /**
   * How many recent years count as "how I write now".
   *
   * Writing habits drift over a decade of chat history — punctuation and
   * message length noticeably among them — so the constraints handed to a model
   * describe this window rather than the average of every year on record.
   */
  recentYears: number
}

type Env = Record<string, string | undefined>

const DEFAULT_BURST_WINDOW_SECONDS = 90
const DEFAULT_LONGFORM_MIN_CHARS = 300
const DEFAULT_HOLDOUT_SIZE = 20
const DEFAULT_RECENT_YEARS = 3

/**
 * The corpus lives in the user's config directory, never beside the code.
 * Installed through mise or npm the package sits in a version-scoped cache
 * directory that is replaced wholesale on upgrade — an index written there
 * would silently disappear, taking a 15-second rebuild and the holdout set
 * with it. XDG_CONFIG_HOME is honoured where it is set.
 */
function defaultDataDir(env: Env): string {
  const xdg = env.XDG_CONFIG_HOME?.trim()
  const base = xdg || join(homedir(), '.config')
  return join(base, 'thinks-mcp')
}

/** Build a typed Config from environment variables. Pure: no IO. */
export function loadConfig(env: Env = process.env): Config {
  const dataDir = env.THINKS_DATA_DIR?.trim() || defaultDataDir(env)

  return {
    dumpPath: env.THINKS_DUMP?.trim() || join(dataDir, 'dump.json'),
    dataDir,
    dbPath: env.THINKS_DB?.trim() || join(dataDir, 'style.db'),
    ownerId: env.THINKS_OWNER_ID?.trim() ?? '',
    chatStopList: splitList(env.THINKS_CHAT_STOPLIST),
    burstWindowSeconds:
      Number.parseInt(env.THINKS_BURST_WINDOW ?? '', 10) ||
      DEFAULT_BURST_WINDOW_SECONDS,
    longformMinChars:
      Number.parseInt(env.THINKS_LONGFORM_MIN ?? '', 10) ||
      DEFAULT_LONGFORM_MIN_CHARS,
    holdoutSize:
      Number.parseInt(env.THINKS_HOLDOUT ?? '', 10) || DEFAULT_HOLDOUT_SIZE,
    codeEmails: splitList(env.THINKS_CODE_EMAILS),
    recentYears:
      Number.parseInt(env.THINKS_RECENT_YEARS ?? '', 10) ||
      DEFAULT_RECENT_YEARS,
  }
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

/** Create the data directory if it does not exist. Call before writing files. */
export function ensureDataDir(cfg: Config): void {
  mkdirSync(cfg.dataDir, { recursive: true })
}
