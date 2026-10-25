import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { DEFAULT_SETTINGS, Users } from './users.ts'

const fresh = () => new Users(mkdtempSync(join(tmpdir(), 'thinks-users-')))

describe('Users', () => {
	it('пускает в файлы только по числовому id', () => {
		const users = fresh()

		for (const id of ['../1', '1/../../etc', '', 'abc', '1 ']) {
			assert.throws(() => users.dir(id), /Bad user id/, JSON.stringify(id))
		}

		assert.ok(users.dir('42').endsWith(join('users', '42')))
	})

	it('перечисляет только каталоги пользователей', () => {
		const users = fresh()

		assert.deepEqual(users.list(), [])
		mkdirSync(users.dir('1'), { recursive: true })
		mkdirSync(users.dir('20'), { recursive: true })
		mkdirSync(join(users.dir('1'), '..', 'tmp'), { recursive: true })

		assert.deepEqual(users.list().sort(), ['1', '20'])
	})

	it('дополняет сохранённые настройки умолчаниями', () => {
		const users = fresh()

		assert.deepEqual(users.settings('1'), DEFAULT_SETTINGS)
		mkdirSync(users.dir('1'), { recursive: true })
		writeFileSync(join(users.dir('1'), 'settings.json'), JSON.stringify({ voice: true }))

		assert.deepEqual(users.settings('1'), { ...DEFAULT_SETTINGS, voice: true })
	})

	it('строит конфиг корпуса из настроек пользователя', () => {
		const users = fresh()

		users.saveSettings('1', { neverMarks: '…:...', chatStopList: 'Работа, Семья', recentYears: 5, voice: true })

		const cfg = users.config('1')

		assert.equal(cfg.dataDir, users.dir('1'))
		assert.equal(cfg.dbPath, join(users.dir('1'), 'style.db'))
		assert.deepEqual(cfg.neverMarks, [{ mark: '…', standIn: '...' }])
		assert.deepEqual(cfg.chatStopList, ['Работа', 'Семья'])
		assert.equal(cfg.recentYears, 5)
		assert.equal(cfg.voice, true)
	})

	it('держит открытыми не больше 16 корпусов и закрывает самый давний', () => {
		const users = fresh()
		const first = users.corpus('1')
		const second = users.corpus('2')

		assert.equal(users.corpus('1'), first)

		for (let id = 3; id <= 16; id++) users.corpus(String(id))

		// Обращение поднимает первого наверх, и семнадцатый вытесняет второго.
		assert.equal(users.corpus('1'), first)
		users.corpus('17')
		assert.equal(users.corpus('1'), first)
		assert.notEqual(users.corpus('2'), second)
	})

	it('сбрасывает открытый корпус, когда меняются настройки', () => {
		const users = fresh()
		const before = users.corpus('1')

		users.saveSettings('1', { ...DEFAULT_SETTINGS, neverMarks: '—:--' })

		assert.notEqual(users.corpus('1'), before)
	})
})
