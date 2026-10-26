/**
 * Страницы thinks на настоящей сборке Astro: лендинг, вход в кабинет, кабинет во всех состояниях
 * сборки и OAuth-вход клиента. Сервер из исходников, страницы -- из build/public, поэтому перед
 * запуском нужен `npm run build`. CSP режет инлайн-код молча, так что любая строка "Refused to"
 * в консоли -- провал. Скриншоты не сравниваем: шрифты на раннере другие. Они ложатся
 * в test-results/screens, для глаз и для PR.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { memoryStore } from '@aimuzov/infra-mcp-kit/http'
import { connectHttp, devLink, oauthFlow, startHttp, type RunningHttp } from '@aimuzov/infra-mcp-kit/testing'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

import { createApp, PUBLIC_DIR } from '#thinks/http/app'
import { BUILD_STEPS, Builds, type BuildRunner } from '#thinks/http/builds'
import type { ThinksHttpConfig } from '#thinks/http/config'
import { Users } from '#thinks/http/users'

const SHOTS = fileURLToPath(new URL('../test-results/screens', import.meta.url))
const USER = '1'

let http: RunningHttp
let browser: Browser
let users: Users
let dataDir: string
const problems: string[] = []

/** Сборка без корпуса: проходит шаги и кладёт пустой файл базы, этого кабинету хватает. */
const fakeBuild: BuildRunner = async (job, progress) => {
	for (const _ of BUILD_STEPS) progress()

	writeFileSync(job.dbPath, '')

	return null
}

before(async () => {
	assert.ok(existsSync(join(PUBLIC_DIR, 'account.html')), 'страницы не собраны: сначала npm run build')

	dataDir = mkdtempSync(join(tmpdir(), 'thinks-e2e-'))
	users = new Users(dataDir)

	const builds = new Builds(users, dataDir, fakeBuild)

	http = await startHttp((base) => {
		const cfg: ThinksHttpConfig = {
			http: { port: 0, publicUrl: new URL(base), authSecret: 'x'.repeat(32), allowedRedirectUris: [] },
			telegramBotToken: '',
			telegramBotName: '',
			dataDir,
			maxUploadBytes: 1024 * 1024,
			buildHeapMb: 256,
			devUserId: USER,
		}

		return createApp({ cfg, store: memoryStore(), users, builds })
	})

	browser = await chromium.launch()
	mkdirSync(SHOTS, { recursive: true })
})

after(async () => {
	await browser?.close()
	await http?.close()
	rmSync(dataDir, { recursive: true, force: true })
})

async function open(
	scheme: 'light' | 'dark',
	width = 1280,
	locale?: string,
): Promise<{ context: BrowserContext; page: Page }> {
	// `locale` браузера уходит в Accept-Language: по нему сервер выбирает язык страниц.
	const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, locale })
	const page = await context.newPage()

	page.on('console', (message) => {
		// 401 от /account/state у гостя -- так AccountShell узнаёт, что показать экран входа.
		if (/status of 401/.test(message.text())) return

		// 415 вызывает тест ошибки API: настройки без JSON отвергаются нарочно.
		if (/status of 415/.test(message.text())) return

		if (message.type() === 'error' || /Refused to/.test(message.text())) problems.push(message.text())
	})

	page.on('pageerror', (error) => problems.push(error.message))

	return { context, page }
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true })

/** Состояние сборки, как его пишет Builds: кабинет читает этот файл на каждый запрос. */
function status(state: string, extra: Record<string, unknown> = {}) {
	mkdirSync(users.dir(USER), { recursive: true })

	writeFileSync(
		join(users.dir(USER), 'build.json'),
		JSON.stringify({ state, message: 'Собираю реплики', updatedAt: Date.now(), ...extra }),
	)
}

describe('страницы thinks', () => {
	test('лендинг ведёт в кабинет, а подпись автора -- из site-kit', async () => {
		const { context, page } = await open('light')

		await page.goto(`${http.base}/`)
		assert.equal(await page.getByRole('link', { name: 'Открыть кабинет' }).getAttribute('href'), '/account')
		assert.ok(await page.locator('footer .credit').count(), 'в подвале нет Credit из site-kit')
		await shot(page, 'landing.light')
		await context.close()
	})

	test('гость доходит до кабинета через страницу входа', async () => {
		const { context, page } = await open('light')

		await page.goto(`${http.base}/account`)
		await page.getByRole('link', { name: 'Войти' }).click()
		await page.waitForURL('**/account/signin')
		await shot(page, 'signin.light')
		await page.getByRole('link', { name: /Войти как 1/ }).click()
		await page.waitForURL('**/account')
		await page.getByRole('heading', { name: 'Привет, dev' }).waitFor()
		await page.getByRole('heading', { name: 'Корпуса пока нет' }).waitFor()
		await context.close()
	})

	test('загрузка выгрузки доходит до собранного корпуса', async () => {
		const { context, page } = await open('light')

		await page.goto(`${http.base}/account/login?dev=1`)

		await page.locator('input[type=file]').setInputFiles({
			name: 'result.json',
			mimeType: 'application/json',
			buffer: Buffer.from('{}'),
		})

		await page.getByRole('heading', { name: 'Корпус собран' }).waitFor()
		assert.equal(users.hasCorpus(USER), true)
		await context.close()
	})

	test('настройки сохраняются и переживают перезагрузку', async () => {
		const { context, page } = await open('light')

		await page.goto(`${http.base}/account/login?dev=1`)
		await page.getByLabel('Сколько последних лет').fill('7')
		await page.getByLabel('Claude говорит со мной моим голосом').check()
		await page.getByRole('button', { name: 'Сохранить' }).click()
		await page.getByText('Сохранено').waitFor()
		assert.equal(users.settings(USER).recentYears, 7)
		assert.equal(users.settings(USER).voice, true)
		await page.reload()
		assert.equal(await page.getByLabel('Сколько последних лет').inputValue(), '7')
		await context.close()
	})

	test('кабинет во всех состояниях сборки, в обеих темах и на телефоне', async () => {
		const states: Array<[string, () => void]> = [
			['empty', () => rmSync(users.dir(USER), { recursive: true, force: true })],
			['queued', () => status('queued', { message: 'В очереди' })],
			['building', () => status('building', { step: 3, steps: BUILD_STEPS.length })],
			['failed', () => status('failed', { message: 'В выгрузке нет сообщений владельца' })],
			[
				'ready',
				() => {
					status('ready', { message: 'Корпус собран' })
					writeFileSync(users.config(USER).dbPath, '')
				},
			],
		]

		for (const scheme of ['light', 'dark'] as const) {
			for (const [width, device] of [
				[1280, 'desktop'],
				[390, 'phone'],
			] as const) {
				const { context, page } = await open(scheme, width)

				await page.goto(`${http.base}/account/login?dev=1`)

				for (const [name, apply] of states) {
					apply()
					await page.reload()
					await page.getByRole('heading', { name: 'Привет, dev' }).waitFor()
					// Анимации спиннера и полосы не ждём: снимок нужен для глаз, а не для сравнения.
					await shot(page, `account-${name}.${scheme}.${device}`)
				}

				await context.close()
			}
		}
	})

	test('английский браузер: лендинг, вход, кабинет и шаги сборки по-английски', async () => {
		const { context, page } = await open('light', 1280, 'en-US')

		await page.goto(`${http.base}/`)
		assert.equal(new URL(page.url()).pathname, '/en/')
		assert.equal(await page.locator('html').getAttribute('lang'), 'en')
		assert.equal(await page.getByRole('link', { name: 'Open the account' }).getAttribute('href'), '/en/account')
		await page.getByRole('link', { name: 'Open the account' }).click()
		await page.getByRole('link', { name: 'Sign in' }).click()
		await page.waitForURL('**/en/account/signin')
		await page.getByRole('link', { name: /Sign in as 1/ }).click()
		await page.waitForURL('**/en/account')
		await page.getByRole('heading', { name: 'Hi, dev' }).waitFor()

		status('building', { step: 3, steps: BUILD_STEPS.length })
		await page.reload()
		await page.getByText('Collecting replies').waitFor()

		status('failed', {
			message: 'Сервер перезапустился, загрузи заново',
			messageEn: 'The server restarted, upload again',
		})

		await page.reload()
		await page.getByText('The server restarted, upload again').waitFor()
		rmSync(users.dir(USER), { recursive: true, force: true })
		await context.close()
	})

	test('ошибка API кабинета приходит на языке страницы', async () => {
		const { context, page } = await open('light', 1280, 'en-US')

		await page.goto(`${http.base}/en/account/signin`)
		await page.getByRole('link', { name: /Sign in as 1/ }).click()
		await page.waitForURL('**/en/account')

		const res = await page.evaluate(async () => {
			const r = await fetch('/account/settings', {
				method: 'POST',
				body: 'x',
				headers: { accept: 'application/json' },
			})

			return (await r.json()) as { error: { message: string } }
		})

		assert.equal(res.error.message, 'Reload the account page and save again')
		await context.close()
	})

	test('английский кабинет во всех состояниях сборки в обеих темах', async () => {
		const states: Array<[string, () => void]> = [
			['empty', () => rmSync(users.dir(USER), { recursive: true, force: true })],
			['building', () => status('building', { step: 3, steps: BUILD_STEPS.length })],
			[
				'ready',
				() => {
					status('ready', { message: 'Корпус собран', messageEn: 'The corpus is built' })
					writeFileSync(users.config(USER).dbPath, '')
				},
			],
		]

		for (const scheme of ['light', 'dark'] as const) {
			const { context, page } = await open(scheme, 1280, 'en-US')

			await page.goto(`${http.base}/`)
			await shot(page, `en.landing.${scheme}`)
			await page.goto(`${http.base}/en/account/signin`)
			await shot(page, `en.signin.${scheme}`)
			await page.getByRole('link', { name: /Sign in as 1/ }).click()
			await page.waitForURL('**/en/account')

			for (const [name, apply] of states) {
				apply()
				await page.reload()
				await page.getByRole('heading', { name: 'Hi, dev' }).waitFor()
				await shot(page, `en.account-${name}.${scheme}.desktop`)
			}

			await context.close()
		}
	})

	test('клиент входит через статическую страницу Telegram и вызывает инструмент', async () => {
		const flow = await oauthFlow({ base: http.base, login: devLink() })
		const client = await connectHttp(http.base, flow.tokens.access_token)
		const { tools } = await client.listTools()

		assert.ok(tools.some((tool) => tool.name === 'write_as_me'))
	})

	test('ни одна страница не нарушила CSP и не упала', () => {
		assert.deepEqual(problems, [])
	})
})
