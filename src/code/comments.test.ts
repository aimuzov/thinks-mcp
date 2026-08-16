import { describe, expect, it } from 'vitest'
import { detectLang, extractBlocks, syntaxFor } from './comments.js'

describe('syntaxFor', () => {
  it('maps extensions to comment syntax', () => {
    expect(syntaxFor('src/a.ts')).toBe('c')
    expect(syntaxFor('conf.d/x.fish')).toBe('hash')
    expect(syntaxFor('plugin/init.lua')).toBe('lua')
    expect(syntaxFor('README.md')).toBeNull()
  })
})

describe('detectLang', () => {
  it('recognises Russian even when mixed with identifiers', () => {
    expect(detectLang('afterUpdate для этого кейса не подходит')).toBe('ru')
    expect(detectLang('Keeps the corpus outside the package')).toBe('en')
  })
})

describe('extractBlocks', () => {
  it('merges consecutive lines into one block', () => {
    const blocks = extractBlocks(
      [
        'const a = 1',
        '',
        '// Первая строка мысли,',
        '// продолжение той же мысли.',
        'const b = 2',
      ].join('\n'),
      'c'
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0].lines).toEqual([
      'Первая строка мысли,',
      'продолжение той же мысли.',
    ])
    expect(blocks[0].startLine).toBe(3)
    expect(blocks[0].lang).toBe('ru')
  })

  it('splits blocks separated by code', () => {
    const blocks = extractBlocks(
      ['// Один', 'const a = 1', '// Два'].join('\n'),
      'c'
    )
    expect(blocks.map(b => b.lines[0])).toEqual(['Один', 'Два'])
  })

  it('marks a jsdoc block and strips its asterisks', () => {
    const blocks = extractBlocks(
      [
        '/**',
        ' * Меняет backend-окружение.',
        ' *',
        ' * @param backendEnv Следующее значение.',
        ' */',
        'function set() {}',
      ].join('\n'),
      'c'
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0].isDoc).toBe(true)
    expect(blocks[0].lines).toEqual([
      'Меняет backend-окружение.',
      '',
      '@param backendEnv Следующее значение.',
    ])
  })

  it('handles a one-line block comment', () => {
    const blocks = extractBlocks('/* Коротко. */\ncode()', 'c')
    expect(blocks[0].lines).toEqual(['Коротко.'])
    expect(blocks[0].isDoc).toBe(false)
  })

  it('ignores trailing comments — they cannot be told from strings', () => {
    const blocks = extractBlocks(
      ["const url = 'https://example.com' // хвост", 'const b = 2'].join('\n'),
      'c'
    )
    expect(blocks).toHaveLength(0)
  })

  it('reads hash comments and skips the shebang', () => {
    const blocks = extractBlocks(
      ['#!/usr/bin/env fish', '', '# Настоящий комментарий.', 'echo hi'].join(
        '\n'
      ),
      'hash'
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0].lines).toEqual(['Настоящий комментарий.'])
  })

  it('reads lua comments and marks --- as doc', () => {
    const blocks = extractBlocks(
      ['--- Док-строка.', 'local x = 1', '-- Обычная.'].join('\n'),
      'lua'
    )
    expect(blocks[0].isDoc).toBe(true)
    expect(blocks[1].isDoc).toBe(false)
    expect(blocks[1].lines).toEqual(['Обычная.'])
  })

  it('keeps a multi-line /* */ block together', () => {
    const blocks = extractBlocks(
      ['/*', ' * Строка одна', ' * Строка два', ' */', 'code()'].join('\n'),
      'c'
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0].lines).toEqual(['Строка одна', 'Строка два'])
  })

  it('returns nothing for a file without comments', () => {
    expect(extractBlocks('const a = 1\nconst b = 2', 'c')).toEqual([])
  })

  it('attaches the line of code the comment sits above', () => {
    const [block] = extractBlocks(
      ['// Почему так.', 'export function f() {}'].join('\n'),
      'c'
    )
    expect(block.code).toBe('export function f() {}')
  })

  it('looks past a blank line to find that code', () => {
    const [block] = extractBlocks(
      ['// Заголовок секции', '', 'const a = 1'].join('\n'),
      'c'
    )
    expect(block.code).toBe('const a = 1')
  })

  it('leaves code null when the block ends the file', () => {
    const [block] = extractBlocks('const a = 1\n// Хвостовой.', 'c')
    expect(block.code).toBeNull()
  })
})
