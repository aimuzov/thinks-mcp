import type { Config } from '../config.js'
import {
  nextTurnId,
  openDb,
  rebuildIndexes,
  resetRegisters,
  run,
  setMeta,
} from '../store/db.js'
import { stemsOf } from '../search/stem.js'
import { measureCode } from '../style/codeMetrics.js'
import {
  measureRegisters,
  saveCodeProfile,
  loadProfile,
} from '../style/profile.js'
import { pseudonym } from '../corpus/parse.js'
import { emptyScanStats, isRepo, scanRepo, type CodeComment } from './scan.js'

export interface CodeBuildReport {
  repos: { repo: string; blocks: number }[]
  blocks: number
  inline: number
  doc: number
  russian: number
  skippedOther: number
  skippedNoise: number
  filesBlamed: number
}

/** Registers this command owns; nothing else in the database is touched. */
const OWNED = ['code', 'jsdoc']

/**
 * Build the code half of the corpus from git repositories.
 *
 * Comment blocks are stored as turns so that one search, one brief and one set
 * of tools serve both halves: a block's lines are its parts, and the line of
 * code underneath is its context — the same shape as an incoming message and
 * the reply to it.
 */
export function buildCodeCorpus(
  cfg: Config,
  repos: string[],
  emails: string[],
  log: (msg: string) => void = () => {}
): CodeBuildReport {
  const stats = emptyScanStats()
  const comments: CodeComment[] = []

  for (const repo of repos) {
    if (!isRepo(repo)) {
      log(`Пропускаю (не git-репозиторий): ${repo}`)
      continue
    }
    stats.repos++
    const found = scanRepo(repo, { emails }, stats)
    log(`${repo}: ${found.length}`)
    comments.push(...found)
  }

  const db = openDb(cfg.dbPath)
  resetRegisters(db, OWNED)

  const insert = db.prepare(
    `INSERT INTO turn
       (id, chat_key, register, longform, holdout, lang, ts, year, parts, text,
        n_parts, chars, context_in)
     VALUES (?, ?, ?, 0, 0, ?, 0, ?, ?, ?, ?, ?, ?)`
  )

  let id = nextTurnId(db)
  run(db, 'BEGIN')
  try {
    for (const c of comments) {
      insert.run(
        id++,
        // Repositories are pseudonymised the same way chats are: a work
        // repository's name says who the employer is, and the corpus is about
        // how the owner writes, not where they work.
        pseudonym('repo', c.repo),
        c.isDoc ? 'jsdoc' : 'code',
        c.lang,
        c.year,
        JSON.stringify(c.lines),
        c.text,
        c.lines.length,
        c.text.length,
        c.code
      )
    }
    run(db, 'COMMIT')
  } catch (err) {
    run(db, 'ROLLBACK')
    throw err
  }

  log('Перестраиваю поисковые индексы')
  rebuildIndexes(db, stemsOf)

  // Measured on pseudonymised names so no repository name reaches the profile,
  // which is a document the calling model reads.
  const code = measureCode(
    comments.map(c => ({ ...c, repo: pseudonym('repo', c.repo) }))
  )
  const recentFrom = new Date().getUTCFullYear() - cfg.recentYears + 1
  saveCodeProfile(db, {
    builtAt: new Date().toISOString(),
    registers: measureRegisters(db, ['code', 'jsdoc']),
    recent: measureRegisters(db, ['code', 'jsdoc'], recentFrom),
    recentFrom,
    code,
  })
  setMeta(db, 'code_emails', emails.join(','))

  // Real names live only in the returned report, which the CLI prints for the
  // owner and nobody stores.
  const byRepo = new Map<string, number>()
  for (const c of comments) byRepo.set(c.repo, (byRepo.get(c.repo) ?? 0) + 1)

  const report: CodeBuildReport = {
    repos: [...byRepo.entries()]
      .map(([repo, blocks]) => ({ repo, blocks }))
      .sort((a, b) => b.blocks - a.blocks),
    blocks: comments.length,
    inline: code.inline,
    doc: code.doc,
    russian: code.russian,
    skippedOther: stats.skippedOther,
    skippedNoise: stats.skippedNoise,
    filesBlamed: stats.filesBlamed,
  }

  // Loading it back is the cheapest proof that both halves still coexist.
  const merged = loadProfile(db)
  if (!merged?.code) throw new Error('Профиль кода не сохранился.')

  db.close()
  return report
}

export function formatCodeReport(r: CodeBuildReport): string {
  const n = (x: number) => x.toLocaleString('ru')
  const lines = [
    `Блоков комментариев:   ${n(r.blocks)}`,
    `  инлайн:              ${n(r.inline)}`,
    `  JSDoc:               ${n(r.doc)}`,
    `По-русски:             ${Math.round(r.russian * 100)}%`,
    `Файлов проверено:      ${n(r.filesBlamed)}`,
    `Отсеяно чужих блоков:  ${n(r.skippedOther)}`,
    `Отсеяно не-прозы:      ${n(r.skippedNoise)}`,
    '',
    'По репозиториям:',
  ]
  for (const repo of r.repos.slice(0, 20)) {
    lines.push(`  ${repo.repo.padEnd(24)} ${n(repo.blocks)}`)
  }
  return lines.join('\n')
}
