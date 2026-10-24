import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { countWords, markers, type Counts } from './lexicon.ts'

function counts(pairs: [string, number][]): Counts {
	return new Map(pairs)
}

describe('countWords', () => {
	it('lowercases, folds ё and skips single letters', () => {
		const c: Counts = new Map()

		countWords('Ещё раз ещё, я в Ага!', c)
		assert.equal(c.get('еще'), 2)
		assert.equal(c.get('ага'), 1)
		assert.equal(c.has('я'), false)
	})
})

describe('markers', () => {
	it('ranks a distinctive word above an equally common one', () => {
		const mine = counts([
			['не', 5000],
			['ага', 400],
			['норм', 300],
		])
		const theirs = counts([
			['не', 5000],
			['ага', 10],
			['норм', 5],
		])

		const ranked = markers(mine, theirs, { minTotal: 10 })
		const words = ranked.map((m) => m.word)

		assert.ok(words.indexOf('ага') < words.indexOf('не'))
		assert.ok(words.indexOf('норм') < words.indexOf('не'))
	})

	it('ignores words below the frequency floor', () => {
		const ranked = markers(
			counts([
				['редкое', 3],
				['частое', 500],
			]),
			counts([['частое', 100]]),
			{ minTotal: 40 },
		)

		assert.ok(!ranked.map((m) => m.word).includes('редкое'))
	})

	it('returns nothing when either corpus is empty', () => {
		assert.deepEqual(markers(counts([['а', 10]]), counts([])), [])
	})
})
