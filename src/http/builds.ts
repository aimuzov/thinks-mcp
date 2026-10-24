import { spawn } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Users } from './users.ts'

export type BuildState = 'queued' | 'building' | 'ready' | 'failed'

export interface BuildStatus {
	state: BuildState
	message: string
	updatedAt: number
}

export interface BuildJob {
	dataDir: string
	userId: string
	dumpPath: string
	dbPath: string
}

/** Runs one build; resolves with the error text, or null on success. */
export type BuildRunner = (job: BuildJob) => Promise<string | null>

const WORKER = fileURLToPath(new URL('./buildWorker.js', import.meta.url))

/** The default runner: the worker in a child process with a capped heap. */
export function childRunner(heapMb: number): BuildRunner {
	return (job) =>
		new Promise((resolve) => {
			const child = spawn(
				process.execPath,
				[`--max-old-space-size=${heapMb}`, WORKER, job.dataDir, job.userId, job.dumpPath, job.dbPath],
				{ stdio: ['ignore', 'ignore', 'pipe'] },
			)
			let lastLine = ''
			child.stderr.setEncoding('utf8')
			child.stderr.on('data', (chunk: string) => {
				const lines = chunk.trim().split('\n')
				lastLine = lines[lines.length - 1] || lastLine
			})
			child.on('close', (code) => {
				if (code === 0) resolve(null)
				else if (code === null) resolve('Сборке не хватило памяти')
				else resolve(lastLine || `Сборка завершилась с кодом ${code}`)
			})
		})
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
	private running = false

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

	/** Drop an upload that never made it to the queue. */
	discardUpload(userId: string): void {
		rmSync(this.dumpPath(userId), { force: true })
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
		void this.next()
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
		while (this.running || this.queue.length) {
			await new Promise((r) => setTimeout(r, 10))
		}
	}

	private async next(): Promise<void> {
		if (this.running) return
		const userId = this.queue.shift()
		if (!userId) return
		this.running = true

		const target = this.users.config(userId).dbPath
		const tmp = `${target}.building`
		try {
			this.setStatus(userId, 'building', 'Собираю корпус')
			removeDb(tmp)
			const error = await this.run({
				dataDir: this.dataDir,
				userId,
				dumpPath: this.dumpPath(userId),
				dbPath: tmp,
			})
			if (error) {
				removeDb(tmp)
				this.setStatus(userId, 'failed', error)
			} else {
				// Swap in the new corpus only now: a failed build leaves the old one.
				this.users.release(userId)
				removeDb(target)
				renameSync(tmp, target)
				this.setStatus(userId, 'ready', 'Корпус собран')
			}
		} catch (err) {
			removeDb(tmp)
			this.setStatus(userId, 'failed', err instanceof Error ? err.message : String(err))
		} finally {
			rmSync(this.dumpPath(userId), { force: true })
			this.running = false
			void this.next()
		}
	}

	private statusPath(userId: string): string {
		return join(this.users.dir(userId), 'build.json')
	}

	private setStatus(userId: string, state: BuildState, message: string) {
		const status: BuildStatus = { state, message, updatedAt: Date.now() }
		writeFileSync(this.statusPath(userId), JSON.stringify(status))
	}
}

/** A SQLite file and the WAL files that belong to it. */
function removeDb(path: string): void {
	for (const suffix of ['', '-wal', '-shm', '-journal']) {
		rmSync(path + suffix, { force: true })
	}
}
