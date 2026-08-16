/** How a file marks a comment. */
export type CommentSyntax = 'c' | 'hash' | 'lua'

/** A run of consecutive comment lines — the code equivalent of a chat turn. */
export interface CommentBlock {
  /** Comment text with markers stripped, one entry per source line. */
  lines: string[]
  /** 1-based line number of the first comment line. */
  startLine: number
  /** A `/** ... *\/` block, which is a different genre from an inline note. */
  isDoc: boolean
  /** Dominant script of the text. */
  lang: 'ru' | 'en'
  /**
   * First line of code below the block. A comment only makes sense against
   * what it comments on — this is the code equivalent of the incoming message
   * a chat turn answers.
   */
  code: string | null
}

const SYNTAX_BY_EXTENSION: Record<string, CommentSyntax> = {
  ts: 'c',
  tsx: 'c',
  js: 'c',
  jsx: 'c',
  mjs: 'c',
  cjs: 'c',
  mts: 'c',
  cts: 'c',
  svelte: 'c',
  vue: 'c',
  css: 'c',
  scss: 'c',
  less: 'c',
  go: 'c',
  rs: 'c',
  java: 'c',
  kt: 'c',
  swift: 'c',
  c: 'c',
  h: 'c',
  cpp: 'c',
  fish: 'hash',
  sh: 'hash',
  bash: 'hash',
  zsh: 'hash',
  py: 'hash',
  rb: 'hash',
  toml: 'hash',
  yaml: 'hash',
  yml: 'hash',
  conf: 'hash',
  lua: 'lua',
}

export function syntaxFor(path: string): CommentSyntax | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return SYNTAX_BY_EXTENSION[ext] ?? null
}

/**
 * Only whole-line comments are collected, never trailing ones.
 *
 * A trailing comment cannot be told from code without parsing the language:
 * `const url = 'https://x'` contains `//`, and `echo "#1"` contains `#`. The
 * author writes above the code anyway — every example in their own corpus is a
 * whole-line comment — so the ambiguous case is not worth the false positives.
 */
interface LineInfo {
  text: string
  isDoc: boolean
}

function classify(raw: string, syntax: CommentSyntax): LineInfo | null {
  const line = raw.trim()
  if (!line) return null

  if (syntax === 'c') {
    // Block comments: /** doc */, /* note */, and their continuation lines.
    if (line.startsWith('/**')) {
      return { text: stripBlock(line.slice(3)), isDoc: true }
    }
    if (line.startsWith('/*'))
      return { text: stripBlock(line.slice(2)), isDoc: false }
    if (line.startsWith('*/')) return { text: '', isDoc: false }
    if (line.startsWith('*'))
      return { text: line.slice(1).trim(), isDoc: false }
    if (line.startsWith('//'))
      return { text: line.slice(2).trim(), isDoc: false }
    return null
  }

  if (syntax === 'lua') {
    if (line.startsWith('---'))
      return { text: line.slice(3).trim(), isDoc: true }
    if (line.startsWith('--'))
      return { text: line.slice(2).trim(), isDoc: false }
    return null
  }

  // Hash: skip the shebang, it is not prose.
  if (line.startsWith('#!')) return null
  if (line.startsWith('#'))
    return { text: line.replace(/^#+/, '').trim(), isDoc: false }
  return null
}

const stripBlock = (s: string) => s.replace(/\*\/\s*$/, '').trim()

const CYRILLIC = /[а-яё]/i
const LATIN = /[a-z]/i

/** Which script dominates. Decides the `lang` facet. */
export function detectLang(text: string): 'ru' | 'en' {
  let ru = 0
  let en = 0
  for (const ch of text) {
    if (CYRILLIC.test(ch)) ru++
    else if (LATIN.test(ch)) en++
  }
  return ru > en * 0.3 ? 'ru' : 'en'
}

/**
 * Split a source file into comment blocks.
 *
 * Consecutive comment lines form one block, the same way consecutive chat
 * messages form one turn: a four-line explanation is a single thought and
 * teaches nothing when chopped into four one-liners.
 */
export function extractBlocks(
  source: string,
  syntax: CommentSyntax
): CommentBlock[] {
  const blocks: CommentBlock[] = []
  const lines = source.split('\n')

  let current: string[] = []
  let start = 0
  let isDoc = false
  let inBlockComment = false

  /** Index of the source line after the block being accumulated. */
  let endIndex = 0

  const flush = () => {
    // Drop the trailing blank line a `*/` leaves behind.
    while (current.length && !current.at(-1)) current.pop()
    while (current.length && !current[0]) current.shift()
    if (current.length) {
      const text = current.join(' ')
      blocks.push({
        lines: current,
        startLine: start,
        isDoc,
        lang: detectLang(text),
        code: codeBelow(lines, endIndex, syntax),
      })
    }
    current = []
    isDoc = false
  }

  lines.forEach((raw, i) => {
    const trimmed = raw.trim()
    const info = inBlockComment
      ? { text: continuationText(trimmed), isDoc: false }
      : classify(raw, syntax)

    if (!info) {
      inBlockComment = false
      endIndex = i
      flush()
      return
    }

    if (!current.length) {
      start = i + 1
      isDoc = info.isDoc
    }
    current.push(info.text)
    endIndex = i + 1

    if (syntax === 'c') {
      if (!inBlockComment && /^\/\*/.test(trimmed) && !trimmed.includes('*/')) {
        inBlockComment = true
      } else if (inBlockComment && trimmed.includes('*/')) {
        inBlockComment = false
      }
    }
  })

  flush()
  return blocks
}

/**
 * First real line of code under a block, skipping blanks. A blank line between
 * a comment and the code does not mean they are unrelated — the author leaves
 * one before section headers all the time.
 */
function codeBelow(
  lines: string[],
  from: number,
  syntax: CommentSyntax
): string | null {
  for (let i = from; i < Math.min(lines.length, from + 4); i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    if (classify(lines[i], syntax)) return null
    return trimmed.length > 160 ? `${trimmed.slice(0, 159)}…` : trimmed
  }
  return null
}

// Strip the closing `*/` first: doing it after removing leading asterisks
// would eat the `*` and leave a stray `/` as the block's last line.
const continuationText = (line: string) =>
  line
    .replace(/\*\/\s*$/, '')
    .replace(/^\*+/, '')
    .trim()

/** Text of a block as it would be read, one line per source line. */
export const blockText = (block: CommentBlock) => block.lines.join('\n')
