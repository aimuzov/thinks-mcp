import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { detectLang, extractBlocks, syntaxFor } from './comments.ts'

describe('syntaxFor', () => {
	it('maps extensions to comment syntax', () => {
		assert.equal(syntaxFor('src/a.ts'), 'c')
		assert.equal(syntaxFor('conf.d/x.fish'), 'hash')
		assert.equal(syntaxFor('plugin/init.lua'), 'lua')
		assert.equal(syntaxFor('README.md'), null)
	})
})

describe('detectLang', () => {
	it('recognises Russian even when mixed with identifiers', () => {
		assert.equal(detectLang('afterUpdate для этого кейса не подходит'), 'ru')
		assert.equal(detectLang('Keeps the corpus outside the package'), 'en')
	})
})

describe('extractBlocks', () => {
	it('merges consecutive lines into one block', () => {
		const blocks = extractBlocks(
			['const a = 1', '', '// Первая строка мысли,', '// продолжение той же мысли.', 'const b = 2'].join('\n'),
			'c',
		)
		assert.equal(blocks.length, 1)
		assert.deepEqual(blocks[0].lines, ['Первая строка мысли,', 'продолжение той же мысли.'])
		assert.equal(blocks[0].startLine, 3)
		assert.equal(blocks[0].lang, 'ru')
	})

	it('splits blocks separated by code', () => {
		const blocks = extractBlocks(['// Один', 'const a = 1', '// Два'].join('\n'), 'c')
		assert.deepEqual(
			blocks.map((b) => b.lines[0]),
			['Один', 'Два'],
		)
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
			'c',
		)
		assert.equal(blocks.length, 1)
		assert.equal(blocks[0].isDoc, true)
		assert.deepEqual(blocks[0].lines, ['Меняет backend-окружение.', '', '@param backendEnv Следующее значение.'])
	})

	it('handles a one-line block comment', () => {
		const blocks = extractBlocks('/* Коротко. */\ncode()', 'c')
		assert.deepEqual(blocks[0].lines, ['Коротко.'])
		assert.equal(blocks[0].isDoc, false)
	})

	it('ignores trailing comments — they cannot be told from strings', () => {
		const blocks = extractBlocks(["const url = 'https://example.com' // хвост", 'const b = 2'].join('\n'), 'c')
		assert.equal(blocks.length, 0)
	})

	it('reads hash comments and skips the shebang', () => {
		const blocks = extractBlocks(
			['#!/usr/bin/env fish', '', '# Настоящий комментарий.', 'echo hi'].join('\n'),
			'hash',
		)
		assert.equal(blocks.length, 1)
		assert.deepEqual(blocks[0].lines, ['Настоящий комментарий.'])
	})

	it('reads lua comments and marks --- as doc', () => {
		const blocks = extractBlocks(['--- Док-строка.', 'local x = 1', '-- Обычная.'].join('\n'), 'lua')
		assert.equal(blocks[0].isDoc, true)
		assert.equal(blocks[1].isDoc, false)
		assert.deepEqual(blocks[1].lines, ['Обычная.'])
	})

	it('keeps a multi-line /* */ block together', () => {
		const blocks = extractBlocks(['/*', ' * Строка одна', ' * Строка два', ' */', 'code()'].join('\n'), 'c')
		assert.equal(blocks.length, 1)
		assert.deepEqual(blocks[0].lines, ['Строка одна', 'Строка два'])
	})

	it('returns nothing for a file without comments', () => {
		assert.deepEqual(extractBlocks('const a = 1\nconst b = 2', 'c'), [])
	})

	it('attaches the line of code the comment sits above', () => {
		const [block] = extractBlocks(['// Почему так.', 'export function f() {}'].join('\n'), 'c')
		assert.equal(block.code, 'export function f() {}')
	})

	it('looks past a blank line to find that code', () => {
		const [block] = extractBlocks(['// Заголовок секции', '', 'const a = 1'].join('\n'), 'c')
		assert.equal(block.code, 'const a = 1')
	})

	it('leaves code null when the block ends the file', () => {
		const [block] = extractBlocks('const a = 1\n// Хвостовой.', 'c')
		assert.equal(block.code, null)
	})
})
