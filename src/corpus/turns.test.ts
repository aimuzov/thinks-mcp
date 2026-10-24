import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { makeDump, OWNER_ID } from '#thinks/testing/fixtures'

import { emptyStats } from './filter.ts'
import { chatsOf, iterateChats, resolveOwnerId } from './parse.ts'
import { collectSurnames, createSanitizer } from './sanitize.ts'
import { buildTurns } from './turns.ts'
import type { Turn } from './types.ts'

function build() {
	const dump = makeDump()
	const stats = emptyStats()
	const san = createSanitizer(collectSurnames(['Ivan Petrov', 'Sergey Volkov']))
	const turns: Turn[] = []

	for (const chat of iterateChats(chatsOf(dump))) {
		turns.push(
			...buildTurns(chat, san, { ownerId: OWNER_ID, burstWindowSeconds: 90, longformMinChars: 300 }, stats),
		)
	}

	return { turns, stats }
}

describe('resolveOwnerId', () => {
	it('reads the owner off Saved Messages', () => {
		assert.equal(resolveOwnerId(chatsOf(makeDump())), OWNER_ID)
	})
})

describe('buildTurns', () => {
	it('merges a burst into one turn and keeps the parts separate', () => {
		const { turns } = build()
		const burst = turns.find((t) => t.parts[0] === 'Через час.')

		assert.deepEqual(burst?.parts, ['Через час.', 'Может раньше.', 'Напишу как выйду.'])
		assert.equal(burst?.text, 'Через час.\nМожет раньше.\nНапишу как выйду.')
	})

	it('attaches the incoming message as reply context', () => {
		const { turns } = build()
		const burst = turns.find((t) => t.parts[0] === 'Через час.')

		assert.equal(burst?.contextIn, 'Ты когда освободишься?')
	})

	it('prefers the quoted message over the previous one', () => {
		const { turns } = build()
		const quoted = turns.find((t) => t.parts[0] === 'Да, там же.')

		assert.equal(quoted?.contextIn, 'А что с доставкой?')
		assert.equal(quoted?.contextExplicit, true)
	})

	it('marks an inferred pair as inferred and records the lag', () => {
		const { turns } = build()
		const burst = turns.find((t) => t.parts[0] === 'Через час.')

		assert.equal(burst?.contextExplicit, false)
		assert.equal(burst?.contextLag, 10)
	})

	it('does not reuse one incoming message for two turns', () => {
		const { turns } = build()
		const later = turns.find((t) => t.parts[0] === 'Вышел.')

		assert.equal(later?.contextIn, null)
	})

	it('drops forwards, bot messages, pasted JSON and bare links', () => {
		const { turns, stats } = build()
		const texts = turns.flatMap((t) => t.parts)

		assert.ok(!texts.includes('Длинный чужой текст про новости.'))
		assert.ok(!texts.includes('сгенерировано ботом'))

		assert.equal(
			texts.some((t) => t.includes('update_id')),
			false,
		)

		assert.equal(
			texts.some((t) => t === '<ссылка>'),
			false,
		)

		assert.equal(stats.forwarded, 1)
		assert.equal(stats['via-bot'], 1)
		assert.equal(stats.structured, 1)
	})

	it('assigns registers from the chat type', () => {
		const { turns } = build()

		assert.equal(turns.find((t) => t.parts[0] === 'Через час.')?.register, 'dm')
		assert.equal(turns.find((t) => t.parts[0] === 'Не я.')?.register, 'group')
	})

	it('flags a long turn as longform without losing its register', () => {
		const { turns } = build()
		const long = turns.find((t) => t.chars >= 300)

		assert.equal(long?.longform, true)
		assert.equal(long?.register, 'group')
		assert.equal(turns.find((t) => t.parts[0] === 'Не я.')?.longform, false)
	})
})

describe('sanitize', () => {
	it('replaces tagged phone and email with placeholders', () => {
		const { turns } = build()
		const pii = turns.find((t) => t.text.includes('<почта>'))

		assert.ok(pii?.text.includes('<телефон>'))
		assert.ok(!pii?.text.includes('example.com'))
		assert.ok(!pii?.text.includes('999'))
	})

	it('scrubs surnames but keeps the sentence readable', () => {
		const { turns } = build()
		const pii = turns.find((t) => t.text.includes('<почта>'))

		assert.ok(!pii?.text.includes('Volkov'))
		assert.ok(pii?.text.includes('в курсе'))
	})

	it('keeps the visible text of a link, drops the href', () => {
		const { turns } = build()
		const linked = turns.find((t) => t.text.includes('вот сюда'))

		assert.equal(linked?.text, 'Смотри вот сюда')
	})
})
