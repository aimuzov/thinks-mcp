import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { loadThinksHttpConfig } from './config.ts'

const SECRET = 'x'.repeat(32)

const prod = {
	PUBLIC_URL: 'https://thinks.example.com',
	AUTH_SECRET: SECRET,
	TELEGRAM_BOT_TOKEN: '123:token',
	TELEGRAM_BOT_NAME: 'thinks_bot',
	THINKS_DATA_DIR: '/srv/thinks',
}

describe('loadThinksHttpConfig', () => {
	it('собирает конфиг боевого сервера с умолчаниями', () => {
		const cfg = loadThinksHttpConfig(prod)

		assert.equal(cfg.http.publicUrl.href, 'https://thinks.example.com/')
		assert.equal(cfg.http.port, 8080)
		assert.equal(cfg.telegramBotToken, '123:token')
		assert.equal(cfg.telegramBotName, 'thinks_bot')
		assert.equal(cfg.dataDir, '/srv/thinks')
		assert.equal(cfg.maxUploadBytes, 1024 * 1024 * 1024)
		assert.equal(cfg.buildHeapMb, 1024)
		assert.equal(cfg.devUserId, '')
	})

	it('берёт лимиты из окружения в мегабайтах', () => {
		const cfg = loadThinksHttpConfig({
			...prod,
			THINKS_MAX_UPLOAD_MB: '5',
			THINKS_BUILD_HEAP_MB: '2048',
			PORT: '9000',
		})

		assert.equal(cfg.maxUploadBytes, 5 * 1024 * 1024)
		assert.equal(cfg.buildHeapMb, 2048)
		assert.equal(cfg.http.port, 9000)
	})

	for (const name of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_NAME', 'THINKS_DATA_DIR', 'AUTH_SECRET', 'PUBLIC_URL']) {
		it(`не стартует без ${name}`, () => {
			const env: Record<string, string> = { ...prod }

			delete env[name]

			assert.throws(() => loadThinksHttpConfig(env), new RegExp(name))
		})
	}

	it('на localhost с THINKS_DEV_USER_ID обходится без бота', () => {
		const cfg = loadThinksHttpConfig({
			PUBLIC_URL: 'http://localhost:8080',
			AUTH_SECRET: SECRET,
			THINKS_DATA_DIR: '/tmp/thinks',
			THINKS_DEV_USER_ID: '42',
		})

		assert.equal(cfg.devUserId, '42')
		assert.equal(cfg.telegramBotToken, '')
		assert.equal(cfg.telegramBotName, '')
	})

	it('не пускает dev-вход на боевой домен', () => {
		assert.throws(() => loadThinksHttpConfig({ ...prod, THINKS_DEV_USER_ID: '42' }), /THINKS_DEV_USER_ID/)
	})
})
