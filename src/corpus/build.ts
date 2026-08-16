import type { Config } from '../config.js'
import {
  openDb,
  rebuildIndexes,
  resetRegisters,
  setMeta,
  type Db,
} from '../store/db.js'
import { insertTurns, pickHoldout } from '../search/indexer.js'
import { stemsOf } from '../search/stem.js'
import { countWords, markers, type Counts } from '../style/lexicon.js'
import { findAntiPatterns } from '../style/antipatterns.js'
import { measureRegisters, saveChatProfile } from '../style/profile.js'
import { emptyStats, type FilterStats } from './filter.js'
import { iterateChats, readDump, resolveOwnerId } from './parse.js'
import {
  collectSurnames,
  createSanitizer,
  namePrefixes,
  PLACEHOLDER_WORDS,
} from './sanitize.js'
import { buildTurns } from './turns.js'
import type { Turn } from './types.js'

export interface BuildReport {
  ownerId: string
  chats: number
  turns: number
  messages: number
  withContext: number
  longform: number
  holdout: number
  filtered: FilterStats
}

/**
 * Build the corpus, the indexes and the profile from a Telegram export.
 *
 * Two passes over the dump: the first only collects word counts for the
 * background corpus (what the interlocutors say), because the lexicon needs
 * both sides before it can score anything. The second builds the turns.
 */
export function buildCorpus(
  cfg: Config,
  log: (msg: string) => void = () => {}
): BuildReport {
  log(`Читаю ${cfg.dumpPath}`)
  const dump = readDump(cfg.dumpPath)

  const ownerId = cfg.ownerId || resolveOwnerId(dump)
  log(`Владелец архива: ${ownerId}`)

  const names = new Set<string>()
  for (const chat of iterateChats(dump, cfg.chatStopList)) {
    for (const m of chat.messages) if (m.from) names.add(m.from)
  }
  const san = createSanitizer(collectSurnames(names))
  const prefixes = namePrefixes(names)

  const mineWords: Counts = new Map()
  const theirWords: Counts = new Map()
  const mineCapitalized: Counts = new Map()
  const stats = emptyStats()
  const turns: Turn[] = []
  let chats = 0

  for (const chat of iterateChats(dump, cfg.chatStopList)) {
    chats++
    for (const m of chat.messages) {
      if (!m.text) continue
      // Count the sanitized text, not the raw one: a URL contributes "https",
      // "com" and "watch", which would otherwise dominate the markers while
      // saying nothing about how the owner writes.
      const cleaned = san.clean(m.entities)
      if (!cleaned) continue
      if (m.fromId === ownerId) {
        if (!m.isForwarded) countWords(cleaned, mineWords, mineCapitalized)
      } else {
        countWords(cleaned, theirWords)
      }
    }

    turns.push(
      ...buildTurns(
        chat,
        san,
        {
          ownerId,
          burstWindowSeconds: cfg.burstWindowSeconds,
          longformMinChars: cfg.longformMinChars,
        },
        stats
      )
    )
  }

  log(`Собрано ходов: ${turns.length.toLocaleString('ru')}`)

  const holdout = pickHoldout(turns, cfg.holdoutSize)
  const db = openDb(cfg.dbPath)
  // Only the chat registers: a code corpus built earlier must survive this.
  resetRegisters(db, ['dm', 'group'])
  insertTurns(db, turns, holdout)
  rebuildIndexes(db, stemsOf)
  log('Индексы записаны')

  const builtAt = new Date().toISOString()
  const recentFrom = new Date().getUTCFullYear() - cfg.recentYears + 1
  saveChatProfile(db, {
    builtAt,
    registers: measureRegisters(db),
    recent: measureRegisters(db, undefined, recentFrom),
    recentFrom,
    markers: markers(mineWords, theirWords, {
      capitalized: mineCapitalized,
      exclude: word =>
        PLACEHOLDER_WORDS.has(word) ||
        (word.length >= 4 && prefixes.has(word.slice(0, 4))),
    }),
    antiPatterns: findAntiPatterns(turns),
  })
  setMeta(db, 'owner_id', ownerId)
  setMeta(db, 'built_at', builtAt)
  log('Профиль посчитан')

  const report: BuildReport = {
    ownerId,
    chats,
    turns: turns.length,
    messages: turns.reduce((n, t) => n + t.parts.length, 0),
    withContext: turns.filter(t => t.contextIn).length,
    longform: turns.filter(t => t.longform).length,
    holdout: holdout.size,
    filtered: stats,
  }
  setMeta(db, 'report', JSON.stringify(report))
  db.close()
  return report
}

/** Human-readable build summary, printed by the CLI. */
export function formatReport(r: BuildReport): string {
  const n = (x: number) => x.toLocaleString('ru')
  return [
    `Чатов обработано:      ${n(r.chats)}`,
    `Ходов в корпусе:       ${n(r.turns)}`,
    `Сообщений в них:       ${n(r.messages)}`,
    `С контекстом ответа:   ${n(r.withContext)}`,
    `Длинных (longform):    ${n(r.longform)}`,
    `Отложено в holdout:    ${n(r.holdout)}`,
    '',
    'Отсеяно:',
    `  чужие сообщения:     ${n(r.filtered['not-owner'])}`,
    `  форварды:            ${n(r.filtered.forwarded)}`,
    `  через бота:          ${n(r.filtered['via-bot'])}`,
    `  без текста:          ${n(r.filtered.empty)}`,
    `  код и вставки:       ${n(r.filtered.structured)}`,
    `  простыни ссылок:     ${n(r.filtered['link-spam'])}`,
  ].join('\n')
}

export function openCorpus(cfg: Config): Db {
  return openDb(cfg.dbPath)
}
