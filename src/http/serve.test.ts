import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { serveHttp } from './app.ts'

/** Свободный порт: serveHttp берёт его из PORT, а PUBLIC_URL должен его знать заранее. */
async function freePort(): Promise<number> {
	const probe = createServer()

	await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r))

	const { port } = probe.address() as AddressInfo

	await new Promise((r) => probe.close(r))

	return port
}

describe('serveHttp', () => {
	it('поднимает сервер из окружения и помечает прерванные сборки упавшими', async () => {
		const dataDir = mkdtempSync(join(tmpdir(), 'thinks-serve-'))
		const port = await freePort()
		const userDir = join(dataDir, 'users', '1')

		mkdirSync(userDir, { recursive: true })
		writeFileSync(join(userDir, 'upload.json'), '{}')
		writeFileSync(join(userDir, 'build.json'), JSON.stringify({ state: 'building', message: '', updatedAt: 1 }))

		const saved = { ...process.env }

		Object.assign(process.env, {
			PUBLIC_URL: `http://127.0.0.1:${port}`,
			PORT: String(port),
			AUTH_SECRET: 'x'.repeat(32),
			THINKS_DATA_DIR: dataDir,
			THINKS_DEV_USER_ID: '1',
		})

		const server = await serveHttp()

		try {
			const auth = await fetch(`http://127.0.0.1:${port}/account/auth`)

			assert.deepEqual(await auth.json(), { botName: '', dev: '1' })
			assert.ok(existsSync(join(dataDir, 'auth.db')))
			assert.equal(existsSync(join(userDir, 'upload.json')), false)

			const status = readFileSync(join(userDir, 'build.json'), 'utf8')

			assert.equal((JSON.parse(status) as { state: string }).state, 'failed')
		} finally {
			await new Promise((r) => server.close(r))
			process.env = saved
		}
	})
})
