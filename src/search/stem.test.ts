import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { stemEnglish, stemRussian, stemsOf, tokenize } from './stem.ts'

/** Words that must collapse to one stem, or the archive search misses matches. */
const FAMILIES: string[][] = [
	['сообщение', 'сообщения', 'сообщений', 'сообщениями'],
	['работа', 'работы', 'работе', 'работу', 'работой'],
	['красный', 'красная', 'красное', 'красные', 'красного'],
	['делать', 'делал', 'делала', 'делали', 'делаю'],
	['машина', 'машины', 'машине', 'машину'],
	['встреча', 'встречи', 'встрече', 'встречу'],
]

describe('stemRussian', () => {
	for (const family of FAMILIES) {
		it(`collapses ${family[0]} and its forms`, () => {
			const stems = new Set(family.map(stemRussian))

			assert.equal(stems.size, 1)
		})
	}

	it('leaves short words alone', () => {
		assert.equal(stemRussian('не'), 'не')
		assert.equal(stemRussian('в'), 'в')
	})

	it('does not collapse unrelated words', () => {
		assert.notEqual(stemRussian('машина'), stemRussian('встреча'))
		assert.notEqual(stemRussian('дом'), stemRussian('день'))
	})
})

/** English families that must collapse — 23% of the code corpus is English. */
const ENGLISH_FAMILIES: string[][] = [
	['comment', 'comments', 'commenting', 'commented'],
	['retry', 'retries', 'retrying'],
	['cache', 'caches', 'caching', 'cached'],
	['render', 'renders', 'rendering', 'rendered'],
]

describe('stemEnglish', () => {
	for (const family of ENGLISH_FAMILIES) {
		it(`collapses ${family[0]} and its forms`, () => {
			assert.equal(new Set(family.map(stemEnglish)).size, 1)
		})
	}

	it('leaves short words alone', () => {
		assert.equal(stemEnglish('the'), 'the')
		assert.equal(stemEnglish('id'), 'id')
	})

	it('does not collapse unrelated words', () => {
		assert.notEqual(stemEnglish('cache'), stemEnglish('catch'))
	})
})

describe('tokenize', () => {
	it('lowercases, folds ё and drops punctuation', () => {
		assert.deepEqual(tokenize('Ещё раз, Привет!'), tokenize('еще раз привет'))
	})

	it('stems latin words too', () => {
		assert.deepEqual(tokenize('caching retries'), tokenize('cached retry'))
	})

	it('drops single characters', () => {
		assert.deepEqual(tokenize('я в а'), [])
	})

	it('renders a space-joined string for the FTS column', () => {
		assert.equal(stemsOf('Работы много'), `${stemRussian('работы')} ${stemRussian('много')}`)
	})
})
