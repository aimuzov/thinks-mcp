#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { readVersion, runCli } from '@aimuzov/infra-mcp-kit'

import { buildCodeCorpus, formatCodeReport } from './code/build.ts'
import { ensureDataDir, loadConfig } from './config.ts'
import { buildCorpus, formatReport } from './corpus/build.ts'
import type { Register } from './corpus/types.ts'
import { serveHttp } from './http/app.ts'
import { corpusMissing } from './mcp/context.ts'
import { createServer } from './mcp/server.ts'
import { holdoutTurns } from './search/query.ts'
import { exportForServer, openDb } from './store/db.ts'
import { loadProfile, REGISTERS, renderProfile } from './style/profile.ts'

const USAGE = `Usage: thinks-mcp [serve|build <dump.json>|code <репозитории...>|profile [register]|holdout|export <файл>|where|--help]

  serve             запустить MCP-сервер на stdio (по умолчанию)
  serve --http      запустить многопользовательский сервер с OAuth и кабинетом.
                    Настраивается только окружением: PUBLIC_URL, AUTH_SECRET,
                    TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_NAME, THINKS_DATA_DIR, PORT
  build <dump.json> собрать корпус и профиль из выгрузки Telegram
  code <пути...>    собрать корпус комментариев из git-репозиториев.
                    Авторство определяется по email -- задай THINKS_CODE_EMAILS
                    через запятую, иначе берётся git config --global user.email
  profile [reg]     напечатать стиль-профиль
                    (dm | group | longform | code | jsdoc)
  holdout [--answers]
                    отложенные пары для слепой проверки: входящие сообщения,
                    которых нет в индексе. С --answers -- настоящие ответы,
                    чтобы сравнить с тем, что сочинила модель
  export <файл>     копия корпуса для сервера, без кэша git blame
  where             показать, где лежат корпус и профиль

Переменные окружения:
  THINKS_DATA_DIR   каталог с индексом (по умолчанию $XDG_CONFIG_HOME/thinks-mcp
                    или ~/.config/thinks-mcp)
  THINKS_DUMP       путь к выгрузке, если не передан аргументом
  THINKS_DB         путь к файлу индекса
  THINKS_OWNER_ID   id владельца, если автоопределение ошиблось
  THINKS_CHAT_STOPLIST  чаты через запятую, которые не попадут в корпус
  THINKS_CODE_EMAILS    git-адреса автора через запятую (личный и рабочий)
  THINKS_RECENT_YEARS   сколько последних лет считать "как я пишу сейчас" (3)
  THINKS_NEVER_MARKS    знаки, которые не набираю, и замена:
                        —:--,…:...,→:=>,«:",»:"
  THINKS_BURST_WINDOW, THINKS_LONGFORM_MIN, THINKS_HOLDOUT`

function build(args: string[]): void {
	const cfg = loadConfig()

	// The dump is a one-off input, not configuration: taking it as an
	// argument is what makes the packaged binary usable from any directory.
	const arg = args[0]
	const dumpPath = arg ? resolve(arg) : cfg.dumpPath

	if (!existsSync(dumpPath)) {
		throw new Error(`Выгрузка не найдена: ${dumpPath}\n` + 'Укажи путь: `thinks-mcp build ~/Downloads/result.json`')
	}

	ensureDataDir(cfg)
	const report = buildCorpus({ ...cfg, dumpPath }, (msg) => console.error(msg))

	console.error('')
	console.error(formatReport(report))
	console.error('')
	console.error(`Индекс: ${cfg.dbPath}`)
}

function code(args: string[]): void {
	const cfg = loadConfig()

	const paths = args.filter((a) => !a.startsWith('-'))

	if (!paths.length) {
		throw new Error('Укажи хотя бы один репозиторий: `thinks-mcp code ~/Projects/*`')
	}

	const emails = cfg.codeEmails.length ? cfg.codeEmails : defaultEmails()

	if (!emails.length) {
		throw new Error('Не удалось определить твой git-email. Задай THINKS_CODE_EMAILS.')
	}

	ensureDataDir(cfg)
	console.error(`Автор: ${emails.join(', ')}`)
	const report = buildCodeCorpus(
		cfg,
		paths.map((p) => resolve(p)),
		emails,
		(msg) => console.error(msg),
	)

	console.error('')
	console.error(formatCodeReport(report))
	console.error('')
	console.error(`Индекс: ${cfg.dbPath}`)
}

function profile(args: string[]): void {
	const cfg = loadConfig()

	const raw = args[0] ?? 'dm'

	if (!(REGISTERS as string[]).includes(raw)) {
		throw new Error(`Неизвестный регистр: ${raw}. Доступны: ${REGISTERS.join(', ')}`)
	}

	const db = openCorpusOrFail(cfg.dbPath)
	const measured = loadProfile(db)

	if (!measured) throw new Error(notBuilt(cfg.dbPath))

	console.log(renderProfile({ ...measured, neverMarks: cfg.neverMarks }, raw as Register, { full: true }))
	db.close()
}

function holdout(args: string[]): void {
	const cfg = loadConfig()

	const withAnswers = args.includes('--answers')
	const db = openCorpusOrFail(cfg.dbPath)
	const rows = holdoutTurns(db, cfg.holdoutSize)

	if (!rows.length) {
		throw new Error('Отложенных пар нет. Пересобери корпус с THINKS_HOLDOUT больше нуля.')
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
}

function exportCorpus(args: string[]): void {
	const cfg = loadConfig()

	if (!args[0]) throw new Error('Укажи файл: `thinks-mcp export ~/style.db`')

	const dest = resolve(args[0])

	if (existsSync(dest)) throw new Error(`Файл уже есть: ${dest}`)

	const db = openCorpusOrFail(cfg.dbPath)

	exportForServer(db, dest)
	db.close()
	console.error(`Копия для сервера: ${dest}`)
}

function where(): void {
	const cfg = loadConfig()

	console.log(`Каталог данных: ${cfg.dataDir}`)
	console.log(`Индекс:         ${cfg.dbPath}`)
	console.log(`Собран:         ${existsSync(cfg.dbPath) ? 'да' : 'нет, запусти `thinks-mcp build <dump.json>`'}`)
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

const notBuilt = (dbPath: string) => `${corpusMissing('cli', existsSync(dbPath))}\n\nБаза: ${dbPath}`

function openCorpusOrFail(dbPath: string) {
	if (!existsSync(dbPath)) throw new Error(notBuilt(dbPath))

	return openDb(dbPath)
}

await runCli({
	name: 'thinks-mcp',
	version: readVersion(import.meta.url),
	usage: USAGE,
	stdio: () => createServer(loadConfig()),
	http: serveHttp,
	commands: { build, code, profile, holdout, export: exportCorpus, where },
})
