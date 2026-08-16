#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ensureDataDir, loadConfig } from './config.js'
import { buildCodeCorpus, formatCodeReport } from './code/build.js'
import { buildCorpus, formatReport } from './corpus/build.js'
import { serve } from './mcp/server.js'
import { holdoutTurns } from './search/query.js'
import { openDb } from './store/db.js'
import { loadProfile, renderProfile, REGISTERS } from './style/profile.js'
import type { Register } from './corpus/types.js'

const USAGE = `Usage: thinks-mcp [serve|build <dump.json>|code <репозитории...>|profile [register]|holdout|where]

  serve             запустить MCP-сервер на stdio (по умолчанию)
  build <dump.json> собрать корпус и профиль из выгрузки Telegram
  code <пути...>    собрать корпус комментариев из git-репозиториев.
                    Авторство определяется по email — задай THINKS_CODE_EMAILS
                    через запятую, иначе берётся git config user.email
  profile [reg]     напечатать стиль-профиль
                    (dm | group | longform | code | jsdoc)
  holdout [--answers]
                    отложенные пары для слепой проверки: входящие сообщения,
                    которых нет в индексе. С --answers — настоящие ответы,
                    чтобы сравнить с тем, что сочинила модель
  where             показать, где лежат корпус и профиль

Переменные окружения:
  THINKS_DATA_DIR   каталог с индексом (по умолчанию ~/.config/aimuzov-thinks-mcp)
  THINKS_DUMP       путь к выгрузке, если не передан аргументом
  THINKS_DB         путь к файлу индекса
  THINKS_OWNER_ID   id владельца, если автоопределение ошиблось
  THINKS_CHAT_STOPLIST  чаты через запятую, которые не попадут в корпус
  THINKS_CODE_EMAILS    git-адреса автора через запятую (личный и рабочий)
  THINKS_BURST_WINDOW, THINKS_LONGFORM_MIN, THINKS_HOLDOUT`

async function main() {
  const cfg = loadConfig()

  switch (process.argv[2]) {
    case 'build': {
      // The dump is a one-off input, not configuration: taking it as an
      // argument is what makes the packaged binary usable from any directory.
      const arg = process.argv[3]
      const dumpPath = arg ? resolve(arg) : cfg.dumpPath
      if (!existsSync(dumpPath)) {
        throw new Error(
          `Выгрузка не найдена: ${dumpPath}\n` +
            'Укажи путь: `thinks-mcp build ~/Downloads/result.json`'
        )
      }
      ensureDataDir(cfg)
      const report = buildCorpus({ ...cfg, dumpPath }, msg =>
        console.error(msg)
      )
      console.error('')
      console.error(formatReport(report))
      console.error('')
      console.error(`Индекс: ${cfg.dbPath}`)
      return
    }

    case 'code': {
      const paths = process.argv.slice(3).filter(a => !a.startsWith('-'))
      if (!paths.length) {
        throw new Error(
          'Укажи хотя бы один репозиторий: `thinks-mcp code ~/Projects/*`'
        )
      }
      const emails = cfg.codeEmails.length ? cfg.codeEmails : defaultEmails()
      if (!emails.length) {
        throw new Error(
          'Не удалось определить твой git-email. Задай THINKS_CODE_EMAILS.'
        )
      }
      ensureDataDir(cfg)
      console.error(`Автор: ${emails.join(', ')}`)
      const report = buildCodeCorpus(
        cfg,
        paths.map(p => resolve(p)),
        emails,
        msg => console.error(msg)
      )
      console.error('')
      console.error(formatCodeReport(report))
      console.error('')
      console.error(`Индекс: ${cfg.dbPath}`)
      return
    }

    case 'profile': {
      const raw = process.argv[3] ?? 'dm'
      if (!(REGISTERS as string[]).includes(raw)) {
        throw new Error(
          `Неизвестный регистр: ${raw}. Доступны: ${REGISTERS.join(', ')}`
        )
      }
      const db = openCorpusOrFail(cfg.dbPath)
      const profile = loadProfile(db)
      if (!profile) throw new Error(notBuilt(cfg.dbPath))
      console.log(renderProfile(profile, raw as Register, { full: true }))
      db.close()
      return
    }

    case 'holdout': {
      const withAnswers = process.argv.includes('--answers')
      const db = openCorpusOrFail(cfg.dbPath)
      const rows = holdoutTurns(db, cfg.holdoutSize)
      if (!rows.length) {
        throw new Error(
          'Отложенных пар нет. Пересобери корпус с THINKS_HOLDOUT больше нуля.'
        )
      }
      rows.forEach((row, i) => {
        console.log(`[${i + 1}] ${row.register}, ${row.year}`)
        console.log(`  Входящее: ${row.contextIn}`)
        if (withAnswers) {
          for (const part of row.parts) console.log(`  Ответ: ${part}`)
        }
        console.log('')
      })
      db.close()
      return
    }

    case 'where': {
      console.log(`Каталог данных: ${cfg.dataDir}`)
      console.log(`Индекс:         ${cfg.dbPath}`)
      console.log(
        `Собран:         ${existsSync(cfg.dbPath) ? 'да' : 'нет, запусти `thinks-mcp build <dump.json>`'}`
      )
      return
    }

    case undefined:
    case 'serve':
      await serve(cfg)
      return

    default:
      console.error(USAGE)
      process.exit(1)
  }
}

/**
 * Fall back to the git identity configured on this machine. One email is
 * usually not enough — work and personal repositories are signed differently —
 * so THINKS_CODE_EMAILS takes precedence when set.
 */
function defaultEmails(): string[] {
  try {
    const email = execFileSync('git', ['config', '--global', 'user.email'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return email ? [email] : []
  } catch {
    return []
  }
}

const notBuilt = (dbPath: string) =>
  `Корпус не собран: ${dbPath} не найден.\n` +
  'Запусти `thinks-mcp build <путь к выгрузке Telegram>`.'

function openCorpusOrFail(dbPath: string) {
  if (!existsSync(dbPath)) throw new Error(notBuilt(dbPath))
  return openDb(dbPath)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
