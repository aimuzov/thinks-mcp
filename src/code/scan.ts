import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  blockText,
  extractBlocks,
  syntaxFor,
  type CommentBlock,
} from './comments.js'

export interface CodeComment {
  /** Repository directory name — never the full path. */
  repo: string
  lines: string[]
  text: string
  isDoc: boolean
  lang: 'ru' | 'en'
  year: number
  /** The line of code the comment sits above, if any. */
  code: string | null
}

export interface ScanOptions {
  /** Author emails that count as the owner. */
  emails: string[]
  /** Skip files larger than this, in bytes. */
  maxFileBytes?: number
}

export interface ScanStats {
  repos: number
  filesConsidered: number
  filesBlamed: number
  blocks: number
  kept: number
  /** Written by somebody else. */
  skippedOther: number
  /** Section rules, commented-out code — anything that is not prose. */
  skippedNoise: number
}

const DEFAULT_MAX_FILE_BYTES = 400_000

const git = (repo: string, args: string[]): string =>
  execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })

/**
 * Files the owner has ever touched.
 *
 * Blaming every tracked file would take minutes on a large repository and
 * mostly confirm that someone else wrote it. The author can only own comments
 * in files they committed to, so this narrows the work to what can possibly
 * match — intersected with what still exists on disk.
 */
function candidateFiles(repo: string, emails: string[]): string[] {
  const tracked = new Set(git(repo, ['ls-files']).split('\n').filter(Boolean))

  const touched = new Set<string>()
  for (const email of emails) {
    const out = git(repo, [
      'log',
      `--author=${email}`,
      '--pretty=format:',
      '--name-only',
      '--no-merges',
    ])
    for (const line of out.split('\n')) {
      const path = line.trim()
      if (path && tracked.has(path) && syntaxFor(path)) touched.add(path)
    }
  }
  return [...touched]
}

interface BlamedLine {
  line: number
  email: string
  year: number
}

/**
 * Parse `git blame --line-porcelain` into per-line authorship.
 *
 * Porcelain output repeats a header for every line, so the commit metadata is
 * cached: a file whose lines all come from one commit would otherwise re-parse
 * the same author record thousands of times.
 */
function blame(repo: string, path: string): Map<number, BlamedLine> {
  const out = git(repo, ['blame', '--line-porcelain', '--', path])
  const byLine = new Map<number, BlamedLine>()

  let email = ''
  let year = 0
  let lineNo = 0

  for (const raw of out.split('\n')) {
    if (raw.startsWith('author-mail ')) {
      email = raw
        .slice('author-mail '.length)
        .replace(/[<>]/g, '')
        .toLowerCase()
    } else if (raw.startsWith('author-time ')) {
      year = new Date(
        Number(raw.slice('author-time '.length)) * 1000
      ).getUTCFullYear()
    } else if (/^[0-9a-f]{40} \d+ \d+/.test(raw)) {
      lineNo = Number(raw.split(' ')[2])
    } else if (raw.startsWith('\t')) {
      byLine.set(lineNo, { line: lineNo, email, year })
    }
  }
  return byLine
}

/** A block belongs to the owner only if they wrote most of its lines. */
function ownedBy(
  block: CommentBlock,
  blamed: Map<number, BlamedLine>,
  emails: Set<string>
): { owned: boolean; year: number } {
  let mine = 0
  let total = 0
  let year = 0

  for (let i = 0; i < block.lines.length; i++) {
    const info = blamed.get(block.startLine + i)
    if (!info) continue
    total++
    if (emails.has(info.email)) {
      mine++
      year = Math.max(year, info.year)
    }
  }

  return { owned: total > 0 && mine / total > 0.5, year }
}

function readSource(repo: string, path: string): string | null {
  try {
    return readFileSync(join(repo, path), 'utf8')
  } catch {
    return null
  }
}

/** Collect the owner's comments from one repository. */
export function scanRepo(
  repo: string,
  opts: ScanOptions,
  stats: ScanStats
): CodeComment[] {
  const emails = new Set(opts.emails.map(e => e.toLowerCase()))
  const maxBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const name = basename(repo)
  const out: CodeComment[] = []

  for (const path of candidateFiles(repo, opts.emails)) {
    stats.filesConsidered++
    const syntax = syntaxFor(path)
    if (!syntax) continue

    const source = readSource(repo, path)
    if (source == null || source.length > maxBytes) continue

    const blocks = extractBlocks(source, syntax)
    if (!blocks.length) continue

    stats.filesBlamed++
    const blamed = blame(repo, path)

    for (const block of blocks) {
      stats.blocks++
      // Section rules (`// ----------`) and commented-out code are not prose;
      // as examples they teach a model to produce decoration.
      if (!hasProse(block.lines)) {
        stats.skippedNoise++
        continue
      }
      const { owned, year } = ownedBy(block, blamed, emails)
      if (!owned) {
        stats.skippedOther++
        continue
      }
      stats.kept++
      out.push({
        repo: name,
        lines: block.lines,
        text: blockText(block),
        isDoc: block.isDoc,
        lang: block.lang,
        year,
        code: block.code,
      })
    }
  }

  return out
}

/**
 * A block counts as prose only if it has words rather than punctuation and
 * syntax. Filters out section rules and code that was commented out.
 */
/**
 * Machine directives addressed to a tool, not to a reader. They look like
 * comments and read like restated code, which is exactly how they turned up
 * when calibrating the restatement detector.
 */
const DIRECTIVE =
  /^\s*(shellcheck|eslint-disable|eslint-enable|prettier-ignore|biome-ignore|stylelint-|@ts-|ts-ignore|ts-expect-error|istanbul ignore|c8 ignore|v8 ignore|oxlint-disable|deno-lint|noinspection|swiftlint|codeql)/i

function hasProse(lines: string[]): boolean {
  if (lines.every(l => !l.trim() || DIRECTIVE.test(l))) return false

  const text = lines.join(' ')
  const letters = (text.match(/\p{L}/gu) ?? []).length
  if (letters < 4) return false

  // Commented-out code: mostly identifiers, braces and semicolons.
  const syntax = (text.match(/[{}();=<>[\]]/g) ?? []).length
  return syntax / text.length < 0.08
}

export function emptyScanStats(): ScanStats {
  return {
    repos: 0,
    filesConsidered: 0,
    filesBlamed: 0,
    blocks: 0,
    kept: 0,
    skippedOther: 0,
    skippedNoise: 0,
  }
}

/** Is this directory a git repository? */
export function isRepo(dir: string): boolean {
  try {
    return git(dir, ['rev-parse', '--is-inside-work-tree']).trim() === 'true'
  } catch {
    return false
  }
}
