import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { loadConfig } from '#thinks/config'
import { openDb } from '#thinks/store/db'

import { CorpusRef } from './context.ts'

const config = () => loadConfig({ THINKS_DATA_DIR: mkdtempSync(join(tmpdir(), 'thinks-ctx-')) })

describe('CorpusRef.missing', () => {
	it('в CLI советует собрать корпус командой', () => {
		const text = new CorpusRef(config()).missing()

		assert.match(text, /Корпус не собран/)
		assert.match(text, /thinks-mcp build/)
	})

	it('на сервере отправляет в кабинет, а не в CLI', () => {
		const text = new CorpusRef(config(), 'hosted').missing()

		assert.match(text, /кабинете/)
		assert.doesNotMatch(text, /thinks-mcp build/)
	})

	it('отличает базу без профиля от несобранного корпуса', () => {
		const cfg = config()

		openDb(cfg.dbPath).close()

		const ref = new CorpusRef(cfg)

		assert.equal(ref.get(), null)
		assert.match(ref.missing(), /собран не до конца/)
	})
})
