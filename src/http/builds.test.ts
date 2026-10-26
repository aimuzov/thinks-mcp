import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { makeDump } from '#thinks/testing/fixtures'

import {
	BUILD_STEPS,
	Builds,
	childRunner,
	englishOf,
	exitMessage,
	type BuildRunner,
	type BuildStatus,
} from './builds.ts'
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

	it('отмечает сборку упавшей, когда раннер бросил исключение, и идёт дальше по очереди', async () => {
		const { users, builds, ran } = setup(async (job) => {
			if (job.userId === '1') throw new Error('раннер сломался')

			writeFileSync(job.dbPath, '')

			return null
		})

		seedDump(users, builds, '1')
		seedDump(users, builds, '2')
		builds.enqueue('1')
		builds.enqueue('2')
		await builds.idle()

		assert.deepEqual(ran, ['1', '2'])
		assert.equal(builds.status('1')?.state, 'failed')
		assert.equal(builds.status('1')?.message, 'раннер сломался')
		assert.equal(builds.status('2')?.state, 'ready')
		// Выгрузка удаляется при любом исходе.
		assert.equal(existsSync(builds.dumpPath('1')), false)
		assert.equal(existsSync(builds.dumpPath('2')), false)
	})

	it('не даёт шагу уйти за BUILD_STEPS, сколько бы строк ни пришло', async () => {
		const seen: BuildStatus[] = []
		const { users, builds } = setup(async (job, progress) => {
			for (let i = 0; i < BUILD_STEPS.length + 3; i++) {
				progress()
				seen.push(builds.status(job.userId)!)
			}

			return 'стоп'
		})

		seedDump(users, builds, '1')
		builds.enqueue('1')
		await builds.idle()

		assert.deepEqual(
			seen.map((s) => [s.step, s.steps]),
			[1, 2, 3, 4, 5, 5, 5, 5].map((step) => [step, BUILD_STEPS.length]),
		)

		assert.equal(seen.at(-1)?.message, BUILD_STEPS.at(-1))
		assert.equal(builds.status('1')?.state, 'failed')
	})

	it('показывает начало сборки нулевым шагом', async () => {
		let first: BuildStatus | null = null
		const { users, builds } = setup(async (job) => {
			first = builds.status(job.userId)

			return 'стоп'
		})

		seedDump(users, builds, '1')
		builds.enqueue('1')
		await builds.idle()

		assert.deepEqual(
			{ ...first!, updatedAt: 0 },
			{
				state: 'building',
				message: 'Собираю корпус',
				messageEn: 'Building the corpus',
				updatedAt: 0,
				step: 0,
				steps: BUILD_STEPS.length,
			},
		)
	})

	it('после неудачной пересборки оставляет прежний корпус', async () => {
		let fail = false
		const { users, builds } = setup(async (job) => {
			if (fail) {
				writeFileSync(job.dbPath, 'половина')

				return 'Это не твой архив'
			}

			writeFileSync(job.dbPath, 'старый корпус')

			return null
		})

		seedDump(users, builds, '1')
		builds.enqueue('1')
		await builds.idle()
		fail = true
		seedDump(users, builds, '1')
		builds.enqueue('1')
		await builds.idle()

		const { dbPath } = users.config('1')

		assert.equal(builds.status('1')?.message, 'Это не твой архив')
		assert.equal(readFileSync(dbPath, 'utf8'), 'старый корпус')
		assert.equal(existsSync(`${dbPath}.building`), false)
	})

	it('ставит пользователя в очередь один раз и строит по одному', async () => {
		let running = 0
		let peak = 0
		const { users, builds, ran } = setup(async () => {
			running++
			peak = Math.max(peak, running)
			await new Promise((r) => setTimeout(r, 5))
			running--

			return 'стоп'
		})

		for (const id of ['1', '2', '3']) seedDump(users, builds, id)

		builds.enqueue('1')
		builds.enqueue('2')
		builds.enqueue('2')
		builds.enqueue('3')
		assert.equal(builds.status('2')?.state, 'queued')
		await builds.idle()

		assert.deepEqual(ran, ['1', '2', '3'])
		assert.equal(peak, 1)
	})

	it('снимает из очереди ждущую сборку, но не идущую', async () => {
		let release!: () => void
		const gate = new Promise<void>((r) => (release = r))
		const { users, builds, ran } = setup(async () => {
			await gate

			return 'стоп'
		})

		seedDump(users, builds, '1')
		seedDump(users, builds, '2')
		builds.enqueue('1')
		builds.enqueue('2')

		assert.equal(builds.canDelete('1'), false)
		assert.equal(builds.cancel('1'), false)
		assert.equal(builds.canDelete('2'), true)
		assert.equal(builds.cancel('2'), true)
		release()
		await builds.idle()

		assert.deepEqual(ran, ['1'])
		assert.equal(builds.canDelete('1'), true)
	})

	it('не пускает вторую загрузку и не даёт удалить данные, пока идёт первая', () => {
		const { builds } = setup(async () => null)

		assert.equal(builds.beginUpload('1'), true)
		assert.equal(builds.beginUpload('1'), false)
		assert.equal(builds.canDelete('1'), false)
		assert.equal(builds.cancel('1'), false)
		// Загрузка другого пользователя не мешает.
		assert.equal(builds.beginUpload('2'), true)
		builds.endUpload('1')
		assert.equal(builds.beginUpload('1'), true)
	})

	it('после перезапуска честно говорит, что прерванные сборки пропали', () => {
		const { users, builds } = setup(async () => null)
		const write = (id: string, status: Partial<BuildStatus>) => {
			seedDump(users, builds, id)
			writeFileSync(join(users.dir(id), 'build.json'), JSON.stringify({ message: '', updatedAt: 1, ...status }))
		}

		write('1', { state: 'queued' })
		write('2', { state: 'building', step: 3, steps: 5 })
		write('3', { state: 'ready', message: 'Корпус собран' })
		write('4', { state: 'failed', message: 'Это не твой архив' })
		mkdirSync(users.dir('5'), { recursive: true })

		builds.recover(users.list())

		for (const id of ['1', '2']) {
			assert.equal(builds.status(id)?.state, 'failed')
			assert.equal(builds.status(id)?.message, 'Сервер перезапустился, загрузи заново')
			assert.equal(existsSync(builds.dumpPath(id)), false)
		}

		assert.equal(builds.status('3')?.message, 'Корпус собран')
		assert.equal(builds.status('4')?.message, 'Это не твой архив')
		assert.equal(builds.status('5'), null)
	})
})

describe('exitMessage, остальные исходы', () => {
	it('считает SIGKILL без текста работой OOM killer', () => {
		assert.equal(
			spaced(exitMessage(null, 'SIGKILL', '')),
			'Сборку остановила система, скорее всего не хватило памяти',
		)
	})

	it('называет код выхода, когда воркер ничего не написал', () => {
		assert.equal(spaced(exitMessage(3, null, '  \n')), 'Сборка завершилась с кодом 3')
	})
})

describe('childRunner', () => {
	const run = (heapMb = 256) => {
		const dataDir = mkdtempSync(join(tmpdir(), 'thinks-worker-'))
		const users = new Users(dataDir)
		const dir = users.dir('1')

		mkdirSync(dir, { recursive: true })

		const job = { dataDir, userId: '1', dumpPath: join(dir, 'upload.json'), dbPath: join(dir, 'style.db.building') }

		return { job, runner: childRunner(heapMb) }
	}

	it('собирает корпус в отдельном процессе и отчитывается о каждом шаге', async () => {
		const { job, runner } = run()
		let steps = 0

		writeFileSync(job.dumpPath, JSON.stringify(makeDump()))

		assert.equal(await runner(job, () => steps++), null)
		assert.equal(steps, BUILD_STEPS.length)
		assert.ok(existsSync(job.dbPath))
	})

	it('возвращает текст ошибки воркера, когда выгрузка чужая', async () => {
		const { job, runner } = run()

		writeFileSync(job.dumpPath, JSON.stringify(makeDump()))

		const error = await runner({ ...job, userId: '2' }, () => {})

		assert.equal(error, 'Это выгрузка другого аккаунта: user1, а не user2')
	})

	it('не валит сервер, когда выгрузка не JSON или пустая', async () => {
		const { job, runner } = run()

		for (const body of ['', 'это не json', '{}']) {
			writeFileSync(job.dumpPath, body)

			const error = await runner(job, () => {})

			assert.equal(typeof error, 'string', JSON.stringify(body))
			assert.ok(error!.length > 0)
		}
	})

	it('сообщает о нехватке памяти, когда воркеру мало кучи', async () => {
		const { job, runner } = run(16)
		const big = makeDump()
		const chat = big.chats.list[0]!

		// Шестьдесят тысяч сообщений в куче на 16 МБ не разобрать.
		for (let i = 0; i < 60_000; i++) chat.messages.push({ ...chat.messages[1]!, id: 10_000 + i })

		writeFileSync(job.dumpPath, JSON.stringify(big))

		assert.match((await runner(job, () => {})) ?? '', /памяти/)
	})

	it('не роняет процесс, когда воркер не запустился', async () => {
		const { job, runner } = run()
		const execPath = process.execPath

		process.execPath = '/nonexistent/node'

		try {
			assert.match((await runner(job, () => {})) ?? '', /^Не\sудалось\sзапустить\sсборку: .*ENOENT/)
		} finally {
			process.execPath = execPath
		}
	})
})

describe('build-worker', () => {
	it('без аргументов печатает usage и выходит с кодом 2', () => {
		const worker = fileURLToPath(new URL('./build-worker.ts', import.meta.url))
		const res = spawnSync(process.execPath, ['--conditions=thinks-source', worker], { encoding: 'utf8' })

		assert.equal(res.status, 2)
		assert.match(res.stderr, /^usage: build-worker\.js/)
	})
})

function setup(runner: BuildRunner) {
	const dataDir = mkdtempSync(join(tmpdir(), 'thinks-builds-'))
	const users = new Users(dataDir)
	const ran: string[] = []
	const builds = new Builds(users, dataDir, (job, progress) => {
		ran.push(job.userId)

		return runner(job, progress)
	})

	return { users, builds, ran }
}

function seedDump(users: Users, builds: Builds, userId: string) {
	mkdirSync(users.dir(userId), { recursive: true })
	writeFileSync(builds.dumpPath(userId), '{}')
}

/** Сообщения сервера набраны с неразрывными пробелами, тесту важны слова. */
const spaced = (text: string | null) => text?.replace(/\u00a0/g, ' ') ?? null

describe('englishOf', () => {
	it('переводит сообщения сервера, а вывод сборщика оставляет как есть', () => {
		assert.equal(englishOf('Сборка прервана сигналом SIGTERM'), 'The build was stopped by signal SIGTERM')
		assert.equal(englishOf(BUILD_STEPS[0] ?? ''), 'Reading the export')
		assert.equal(englishOf('Битый JSON'), undefined)
	})
})
