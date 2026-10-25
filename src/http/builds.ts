import { spawn } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '@aimuzov/infra-mcp-kit'

import type { Users } from './users.ts'

export type BuildState = 'queued' | 'building' | 'ready' | 'failed'

export type BuildStatus = {
	state: BuildState
	message: string
	updatedAt: number
}

export type BuildJob = {
	dataDir: string
	userId: string
	dumpPath: string
	dbPath: string
}

/** Runs one build; resolves with the error text, or null on success. */
export type BuildRunner = (job: BuildJob) => Promise<string | null>

// From the sources the worker is a .ts file, and it needs the same
// `--conditions` to resolve `#thinks/*`.
const FROM_SOURCE = import.meta.url.endsWith('.ts')
const WORKER = fileURLToPath(new URL(FROM_SOURCE ? './build-worker.ts' : './build-worker.js', import.meta.url))
const CONDITIONS = process.execArgv.filter((arg) => arg.startsWith('--conditions'))

/** The default runner: the worker in a child process with a capped heap. */
export function childRunner(heapMb: number): BuildRunner {
	return (job) =>
		new Promise((resolve) => {
			const child = spawn(
				process.execPath,
				[
					...CONDITIONS,
					`--max-old-space-size=${heapMb}`,
					WORKER,
					job.dataDir,
					job.userId,
					job.dumpPath,
					job.dbPath,
				],
				{ stdio: ['ignore', 'ignore', 'pipe'] },
			)
			let stderr = ''
			let settled = false
			const done = (error: string | null) => {
				if (settled) return

				settled = true
				resolve(error)
			}

			child.stderr.setEncoding('utf8')

			child.stderr.on('data', (chunk: string) => {
				stderr = (stderr + chunk).slice(-STDERR_TAIL)
			})

			// ENOMEM или EAGAIN при запуске: без обработчика это uncaught
			// exception, и падает весь сервер вместе с чужими сессиями.
			child.on('error', (err) => {
				log.error(`Не удалось запустить сборку ${job.userId}`, { error: err.message })
				done(`Не удалось запустить сборку: ${err.message}`)
			})

			child.on('close', (code, signal) => {
				if (code !== 0) log.error(`Сборка ${job.userId} упала`, { code, signal, stderr })

				done(exitMessage(code, signal, stderr))
			})
		})
}

/** Хвост stderr, который хранится для лога; весь вывод сборки не нужен. */
const STDERR_TAIL = 8 * 1024

/** What the user is told about a finished worker; null when it succeeded. */
export function exitMessage(code: number | null, signal: string | null, stderr: string): string | null {
	if (code === 0) return null

	if (/heap out of memory|Reached heap limit/i.test(stderr)) return 'Сборке не хватило памяти'

	// SIGKILL без текста в stderr чаще всего от OOM killer ядра.
	if (signal === 'SIGKILL') return 'Сборку остановила система, скорее всего не хватило памяти'

	if (signal) return `Сборка прервана сигналом ${signal}`

	const lines = stderr.trim().split('\n')

	return lines[lines.length - 1] || `Сборка завершилась с кодом ${code}`
}

/**
 * Corpus builds, one at a time across all users.
 *
 * A build peaks at gigabytes, and the server is small: two at once would push
 * everything else on it into swap. The export is deleted once the build is
 * over, whatever the outcome -- it is the rawest copy of the user's
 * correspondence and nothing needs it after this.
 */
export class Builds {
	private readonly queue: string[] = []
	/** The user whose build is running now. */
	private current: string | null = null
	private readonly uploads = new Set<string>()

	private readonly users: Users
	private readonly dataDir: string
	private readonly run: BuildRunner

	constructor(users: Users, dataDir: string, run: BuildRunner) {
		this.users = users
		this.dataDir = dataDir
		this.run = run
	}

	dumpPath(userId: string): string {
		return join(this.users.dir(userId), 'upload.json')
	}

	/**
	 * Claim dumpPath(userId) for a new upload; false while another upload or a
	 * build of the same user is under way.
	 */
	beginUpload(userId: string): boolean {
		if (this.uploads.has(userId) || this.queue.includes(userId) || this.current === userId) return false

		this.uploads.add(userId)

		return true
	}

	endUpload(userId: string): void {
		this.uploads.delete(userId)
	}

	/** Drop an upload that never made it to the queue. */
	discardUpload(userId: string): void {
		rmSync(this.dumpPath(userId), { force: true })
	}

	/**
	 * Take the user's build out of the queue before their files go away.
	 * False when the build is running or an upload is in flight: neither can
	 * be stopped half-way, so the caller has to wait.
	 */
	cancel(userId: string): boolean {
		if (this.current === userId || this.uploads.has(userId)) return false

		const at = this.queue.indexOf(userId)

		if (at !== -1) this.queue.splice(at, 1)

		return true
	}

	status(userId: string): BuildStatus | null {
		const path = this.statusPath(userId)

		if (!existsSync(path)) return null

		return JSON.parse(readFileSync(path, 'utf8')) as BuildStatus
	}

	/** Queue a build of the export already saved at dumpPath(userId). */
	enqueue(userId: string): void {
		if (this.queue.includes(userId)) return

		this.queue.push(userId)
		this.setStatus(userId, 'queued', 'В очереди')
		this.kick()
	}

	/**
	 * Builds that were queued or running when the server went down are gone;
	 * say so instead of showing them as in progress forever.
	 */
	recover(userIds: string[]): void {
		for (const id of userIds) {
			const s = this.status(id)

			if (s && (s.state === 'queued' || s.state === 'building')) {
				this.setStatus(id, 'failed', 'Сервер перезапустился, загрузи заново')
				rmSync(this.dumpPath(id), { force: true })
			}
		}
	}

	/** Resolves once the queue is empty. Tests only. */
	async idle(): Promise<void> {
		while (this.current !== null || this.queue.length) {
			await new Promise((r) => setTimeout(r, 10))
		}
	}

	/** Никто не ждёт этот промис, поэтому ошибку из него надо поймать здесь. */
	private kick(): void {
		this.next().catch((err: unknown) => log.error('Очередь сборок сломалась', { error: String(err) }))
	}

	private async next(): Promise<void> {
		if (this.current !== null) return

		const userId = this.queue.shift()

		if (!userId) return

		this.current = userId

		try {
			await this.build(userId)
		} catch (err) {
			this.setStatus(userId, 'failed', err instanceof Error ? err.message : String(err))
		} finally {
			// Очередь сначала, файл потом: ошибка rmSync не должна её остановить.
			this.current = null
			this.kick()
			this.discardUpload(userId)
		}
	}

	private async build(userId: string): Promise<void> {
		const target = this.users.config(userId).dbPath
		const tmp = `${target}.building`

		this.setStatus(userId, 'building', 'Собираю корпус')
		removeDb(tmp)

		try {
			const error = await this.run({
				dataDir: this.dataDir,
				userId,
				dumpPath: this.dumpPath(userId),
				dbPath: tmp,
			})

			if (error) return this.setStatus(userId, 'failed', error)

			// Swap in the new corpus only now: a failed build leaves the old one.
			this.users.release(userId)
			removeDb(target)
			renameSync(tmp, target)
			this.setStatus(userId, 'ready', 'Корпус собран')
		} finally {
			removeDb(tmp)
		}
	}

	private statusPath(userId: string): string {
		return join(this.users.dir(userId), 'build.json')
	}

	private setStatus(userId: string, state: BuildState, message: string): void {
		const status: BuildStatus = { state, message, updatedAt: Date.now() }

		try {
			writeFileSync(this.statusPath(userId), JSON.stringify(status))
		} catch (err) {
			// Каталог пользователя могли удалить; статус тогда писать некуда, а
			// падать из-за него нельзя: процесс один на всех.
			log.error(`Не удалось записать статус сборки ${userId}`, { state, error: String(err) })
		}
	}
}

/** A SQLite file and the WAL files that belong to it. */
function removeDb(path: string): void {
	for (const suffix of ['', '-wal', '-shm', '-journal']) {
		rmSync(path + suffix, { force: true })
	}
}
