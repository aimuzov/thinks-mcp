import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadConfig, type Config } from '#thinks/config'
import { CorpusRef } from '#thinks/mcp/context'

/** What a user can change from the account page. */
export type UserSettings = {
	/** Same format as THINKS_NEVER_MARKS: `—:--,…:...` */
	neverMarks: string
	/** Same format as THINKS_CHAT_STOPLIST: chat names, comma-separated. */
	chatStopList: string
	recentYears: number
	/** Claude talks to the user in the user's voice. Off by default. */
	voice: boolean
}

export const DEFAULT_SETTINGS: UserSettings = {
	neverMarks: '',
	chatStopList: '',
	recentYears: 3,
	voice: false,
}

/** How many users keep their corpus open between requests. */
const OPEN_CORPORA = 16

/**
 * Everything a user owns lives in users/<telegram id>/, and the id only ever
 * comes from a verified token or session, never from the request. That is the
 * whole of the isolation between users, so the id is checked here once more.
 */
export class Users {
	private readonly open = new Map<string, CorpusRef>()

	private readonly dataDir: string

	constructor(dataDir: string) {
		this.dataDir = dataDir
	}

	dir(userId: string): string {
		if (!/^\d+$/.test(userId)) throw new Error(`Bad user id: ${userId}`)

		return join(this.dataDir, 'users', userId)
	}

	/** Everyone who has anything on the server. */
	list(): string[] {
		try {
			return readdirSync(join(this.dataDir, 'users')).filter((d) => /^\d+$/.test(d))
		} catch {
			return []
		}
	}

	settings(userId: string): UserSettings {
		const path = join(this.dir(userId), 'settings.json')

		if (!existsSync(path)) return { ...DEFAULT_SETTINGS }

		const saved = JSON.parse(readFileSync(path, 'utf8')) as Partial<UserSettings>

		return { ...DEFAULT_SETTINGS, ...saved }
	}

	saveSettings(userId: string, settings: UserSettings): void {
		mkdirSync(this.dir(userId), { recursive: true })
		writeFileSync(join(this.dir(userId), 'settings.json'), JSON.stringify(settings, null, 2))
		// The open corpus carries the old never-marks in its profile.
		this.release(userId)
	}

	/** The same Config the CLI builds from env, pointed at this user's files. */
	config(userId: string): Config {
		const s = this.settings(userId)

		return loadConfig({
			THINKS_DATA_DIR: this.dir(userId),
			THINKS_NEVER_MARKS: s.neverMarks,
			THINKS_CHAT_STOPLIST: s.chatStopList,
			THINKS_RECENT_YEARS: String(s.recentYears),
			THINKS_VOICE: s.voice ? '1' : '',
		})
	}

	hasCorpus(userId: string): boolean {
		return existsSync(this.config(userId).dbPath)
	}

	corpus(userId: string): CorpusRef {
		let ref = this.open.get(userId)

		if (ref) {
			// Re-insert to mark it as most recently used.
			this.open.delete(userId)
		} else {
			ref = new CorpusRef(this.config(userId), 'hosted')
		}

		this.open.set(userId, ref)

		if (this.open.size > OPEN_CORPORA) {
			const [oldest] = this.open.keys()

			this.release(oldest!)
		}

		return ref
	}

	/** Close the user's corpus so the next request opens it afresh. */
	release(userId: string): void {
		this.open.get(userId)?.close()
		this.open.delete(userId)
	}

	/** Delete everything the user has on the server. */
	remove(userId: string): void {
		this.release(userId)
		rmSync(this.dir(userId), { recursive: true, force: true })
	}
}
