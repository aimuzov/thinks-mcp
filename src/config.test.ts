import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { loadConfig } from './config.ts'

describe('loadConfig', () => {
	it('keeps the corpus outside the installed package', () => {
		const cfg = loadConfig({})
		assert.equal(cfg.dataDir, join(homedir(), '.config', 'thinks-mcp'))
		assert.equal(cfg.dbPath, join(cfg.dataDir, 'style.db'))
		// A path inside node_modules or a mise cache would be wiped on upgrade.
		assert.doesNotMatch(cfg.dbPath, /node_modules|\/build\//)
	})

	it('honours XDG_CONFIG_HOME', () => {
		const cfg = loadConfig({ XDG_CONFIG_HOME: '/tmp/xdg' })
		assert.equal(cfg.dataDir, '/tmp/xdg/thinks-mcp')
	})

	it('lets THINKS_DATA_DIR override everything derived from it', () => {
		const cfg = loadConfig({ THINKS_DATA_DIR: '/srv/thinks' })
		assert.equal(cfg.dbPath, '/srv/thinks/style.db')
		assert.equal(cfg.dumpPath, '/srv/thinks/dump.json')
	})

	it('lets THINKS_DB point somewhere else entirely', () => {
		const cfg = loadConfig({
			THINKS_DATA_DIR: '/srv/thinks',
			THINKS_DB: '/mnt/big/style.db',
		})
		assert.equal(cfg.dbPath, '/mnt/big/style.db')
		assert.equal(cfg.dataDir, '/srv/thinks')
	})

	it('parses tuning knobs and falls back to defaults', () => {
		const cfg = loadConfig({
			THINKS_BURST_WINDOW: '120',
			THINKS_HOLDOUT: 'нечисло',
			THINKS_CHAT_STOPLIST: ' Чат один , Чат два ,,',
		})
		assert.equal(cfg.burstWindowSeconds, 120)
		assert.equal(cfg.holdoutSize, 20)
		assert.equal(cfg.longformMinChars, 300)
		assert.deepEqual(cfg.chatStopList, ['Чат один', 'Чат два'])
	})

	it('parses the recency window and the git identity', () => {
		const cfg = loadConfig({
			THINKS_RECENT_YEARS: '5',
			THINKS_CODE_EMAILS: 'me@personal, me@work,',
		})
		assert.equal(cfg.recentYears, 5)
		assert.deepEqual(cfg.codeEmails, ['me@personal', 'me@work'])
	})

	it('falls back to three recent years and no emails', () => {
		const cfg = loadConfig({ THINKS_RECENT_YEARS: 'abc' })
		assert.equal(cfg.recentYears, 3)
		assert.deepEqual(cfg.codeEmails, [])
	})

	it('parses declared marks with their stand-ins', () => {
		const cfg = loadConfig({ THINKS_NEVER_MARKS: '—:--, …:..., →:=>, «, ::' })
		assert.deepEqual(cfg.neverMarks, [
			{ mark: '—', standIn: '--' },
			{ mark: '…', standIn: '...' },
			{ mark: '→', standIn: '=>' },
			{ mark: '«', standIn: '' },
			{ mark: ':', standIn: '' },
		])
		assert.deepEqual(loadConfig({}).neverMarks, [])
	})

	it('takes the dump path and the owner id verbatim', () => {
		const cfg = loadConfig({
			THINKS_DUMP: '/mnt/export/result.json',
			THINKS_OWNER_ID: ' user42 ',
		})
		assert.equal(cfg.dumpPath, '/mnt/export/result.json')
		assert.equal(cfg.ownerId, 'user42')
	})
})
