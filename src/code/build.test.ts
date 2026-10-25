import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { loadConfig } from '#thinks/config'

import { buildCodeCorpus } from './build.ts'

describe('buildCodeCorpus', () => {
	it('без единого репозитория падает, не тронув корпус', () => {
		const cfg = loadConfig({ THINKS_DATA_DIR: mkdtempSync(join(tmpdir(), 'thinks-code-')) })
		const plain = mkdtempSync(join(tmpdir(), 'thinks-plain-'))

		assert.throws(() => buildCodeCorpus(cfg, [plain], ['me@example.com']), /корпус кода не тронут/)
		assert.equal(existsSync(cfg.dbPath), false)
	})
})
