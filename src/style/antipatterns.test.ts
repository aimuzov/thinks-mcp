import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { measureTypography, shareOf } from './antipatterns.ts'

const share = (label: string, texts: string[]) => shareOf(measureTypography(texts), label)

describe('measureTypography', () => {
	it('counts a mark once per text, whatever the number of hits', () => {
		assert.equal(share('кавычки-ёлочки «»', ['«раз» и «два»', 'без них']), 50)
	})

	it('takes the double hyphen only where it stands for a dash', () => {
		const texts = [
			'pidof вместо wget --no-check-certificate',
			'docker compose --profile amneziawg up -d',
			'---------- чтение ----------',
			'ключ--значение',
			'Кеш живёт до перезапуска -- дольше не нужно.',
		]
		assert.equal(share('двойной дефис --', texts), 20)
	})

	it('tells the ellipsis character and the arrow from their ASCII spelling', () => {
		const texts = ['Ну...', 'Ну…', 'a => b', 'a → b']
		assert.equal(share('многоточие одним знаком …', texts), 25)
		assert.equal(share('стрелка →', texts), 25)
	})

	it('leaves every probe at zero for a corpus without them', () => {
		const measured = measureTypography(['Обычный текст без знаков.'])
		assert.equal(
			measured.every((a) => a.share === 0),
			true,
		)
	})

	it('returns undefined for a probe that was never measured', () => {
		assert.equal(shareOf([], 'длинное тире —'), undefined)
		assert.equal(shareOf(undefined, 'длинное тире —'), undefined)
	})
})
