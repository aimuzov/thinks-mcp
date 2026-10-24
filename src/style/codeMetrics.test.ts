import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { measureCode, splitMarkers, type CodeBlockInput } from './codeMetrics.ts'

const block = (lines: string[], extra: Partial<CodeBlockInput> = {}): CodeBlockInput => ({
	repo: 'repo-a',
	lines,
	text: lines.join('\n'),
	isDoc: false,
	lang: 'ru',
	year: 2020,
	...extra,
})

describe('measureCode', () => {
	it('measures inline and doc genres apart', () => {
		const m = measureCode([
			block(['Коротко.']),
			block(['Тоже коротко.']),
			block(['Первая строка.', 'Вторая.', 'Третья.'], { isDoc: true }),
			block(['Раз.', 'Два.', 'Три.', 'Четыре.'], { isDoc: true }),
		])

		assert.equal(m.genres.code.blockLines.median, 1)
		assert.ok(m.genres.jsdoc.blockLines.median > 1)
		assert.equal(m.genres.code.blocks, 2)
		assert.equal(m.genres.jsdoc.blocks, 2)
	})

	it('counts causal connectives, which is what makes a comment explain', () => {
		const m = measureCode([block(['Так сделано потому что иначе ломается сборка.']), block(['Просто факт.'])])
		const phrases = m.connectives.map((c) => c.phrase)
		assert.ok(phrases.includes('потому что'))
		assert.ok(phrases.includes('иначе'))
	})

	it('separates own markers from foreign ones', () => {
		const m = measureCode([
			block(['TODO: Доделать.']),
			block(['NOTE: Неочевидно.']),
			block(['FIXME: чужой маркер']),
		])
		const byName = Object.fromEntries(m.markers.map((x) => [x.name, x.count]))
		assert.equal(byName.TODO, 1)
		assert.equal(byName.NOTE, 1)
		assert.equal(byName.FIXME, 1)
	})

	it("treats a marker seen a couple of times as somebody else's", () => {
		const m = measureCode([
			...Array.from({ length: 40 }, () => block(['TODO: Доделать.'])),
			...Array.from({ length: 6 }, () => block(['NOTE: Неочевидно.'])),
			block(['FIXME: чужой маркер']),
		])
		const { own, foreign } = splitMarkers(m)
		assert.deepEqual(own, ['TODO', 'NOTE'])
		assert.ok(foreign.includes('FIXME'))
		assert.ok(foreign.includes('IMPORTANT'))
	})

	it('claims no markers for a corpus without any', () => {
		assert.deepEqual(splitMarkers(measureCode([block(['Просто факт.'])])).own, [])
	})

	it('reports the language split and the repositories', () => {
		const m = measureCode([
			block(['Русский комментарий.']),
			block(['English comment here.'], { lang: 'en', repo: 'repo-b' }),
		])
		assert.equal(m.russian, 0.5)
		assert.deepEqual(m.repos.map((r) => r.repo).sort(), ['repo-a', 'repo-b'])
	})

	it('counts typography only over the handwritten years', () => {
		const handwritten = Array.from({ length: 200 }, () =>
			block(['Кеш живёт до перезапуска -- дольше не нужно.'], { year: 2023 }),
		)
		const assisted = Array.from({ length: 400 }, () =>
			block(['Кеш живёт до перезапуска — дольше не нужно.'], { year: 2026 }),
		)
		const blocks = [...handwritten, ...assisted]

		const dash = (m: ReturnType<typeof measureCode>) =>
			m.typography?.code?.find((a) => a.label === 'длинное тире —')?.share

		assert.ok(Math.abs((dash(measureCode(blocks)) ?? Number.NaN) - 66.667) < 0.005)
		assert.equal(dash(measureCode(blocks, 2026)), 0)
	})

	it('leaves a genre unmeasured when the window keeps too few lines', () => {
		const blocks = [
			block(['Ещё до всего.'], { year: 2023 }),
			...Array.from({ length: 300 }, () => block(['Свежее.'], { year: 2026 })),
		]
		assert.equal(measureCode(blocks, 2026).typography?.code, undefined)
		assert.notEqual(measureCode(blocks).typography?.code, undefined)
	})

	it('survives an empty corpus', () => {
		const m = measureCode([])
		assert.equal(m.blocks, 0)
		assert.equal(m.genres.code.lineWidth.median, 0)
	})
})
