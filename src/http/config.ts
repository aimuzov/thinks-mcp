import { int, required, type Env } from '@aimuzov/infra-mcp-kit'
import { devOnly, loadHttpConfig, type HttpConfig } from '@aimuzov/infra-mcp-kit/http'

/** What the hosted server needs on top of the kit's connector settings. */
export type ThinksHttpConfig = {
	http: HttpConfig
	/** Bot that backs the Telegram Login widget; its domain must be publicUrl. */
	telegramBotToken: string
	telegramBotName: string
	/** Root of users/<telegram id>/ and the server's own auth.db. */
	dataDir: string
	/** Largest Telegram export accepted for upload. */
	maxUploadBytes: number
	/** Heap of the child process that builds a corpus. */
	buildHeapMb: number
	/**
	 * Log in as this Telegram id without the widget. The widget only works on the
	 * domain the bot is bound to, so this is how the server is tried on
	 * localhost; it refuses to start with it anywhere else.
	 */
	devUserId: string
}

const MB = 1024 * 1024

export function loadThinksHttpConfig(env: Env = process.env): ThinksHttpConfig {
	const http = loadHttpConfig(env)
	const devUserId = devOnly(env, 'THINKS_DEV_USER_ID', http.publicUrl)

	return {
		http,
		telegramBotToken: devUserId ? '' : required(env, 'TELEGRAM_BOT_TOKEN'),
		telegramBotName: devUserId ? '' : required(env, 'TELEGRAM_BOT_NAME'),
		dataDir: required(env, 'THINKS_DATA_DIR'),
		maxUploadBytes: int(env, 'THINKS_MAX_UPLOAD_MB', 1024) * MB,
		buildHeapMb: int(env, 'THINKS_BUILD_HEAP_MB', 1024),
		devUserId,
	}
}
