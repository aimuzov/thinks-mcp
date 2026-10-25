import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { Builds, exitMessage } from './builds.ts'
import { Users } from './users.ts'

describe('exitMessage', () => {
	it('молчит об успехе', () => {
		assert.equal(exitMessage(0, null, 'Профиль посчитан'), null)
	})

	it('отдаёт последнюю строку stderr, когда воркер сам объяснил ошибку', () => {
		assert.equal(exitMessage(1, null, 'Читаю dump.json\nЭто не твой архив\n'), 'Это не твой архив')
	})

	it('узнаёт нехватку памяти по тексту V8', () => {
		const stderr = 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n 1: 0x1'

		assert.equal(exitMessage(null, 'SIGABRT', stderr), 'Сборке не хватило памяти')
	})

	it('не выдаёт любой сигнал за нехватку памяти', () => {
		assert.equal(exitMessage(null, 'SIGTERM', ''), 'Сборка прервана сигналом SIGTERM')
	})
})

describe('Builds', () => {
	it('переживает каталог пользователя, удалённый посреди сборки', async () => {
		const dataDir = mkdtempSync(join(tmpdir(), 'thinks-builds-'))
		const users = new Users(dataDir)
		const builds = new Builds(users, dataDir, async (job) => {
			rmSync(users.dir(job.userId), { recursive: true, force: true })

			return 'сломалось'
		})

		mkdirSync(users.dir('1'), { recursive: true })
		mkdirSync(users.dir('2'), { recursive: true })
		builds.enqueue('1')
		builds.enqueue('2')
		await builds.idle()

		// Статус писать уже некуда, но очередь дошла до конца и процесс жив.
		assert.equal(builds.status('1'), null)
		assert.equal(builds.status('2'), null)
	})
})
