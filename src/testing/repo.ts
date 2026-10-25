import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const REPO_OWNER_EMAIL = 'me@example.com'

/** Git без глобального конфига машины: тест не должен зависеть от того, кто его запускает. */
function git(repo: string, args: string[], email: string) {
	execFileSync('git', ['-C', repo, ...args], {
		stdio: 'ignore',
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: '/dev/null',
			GIT_CONFIG_NOSYSTEM: '1',
			GIT_AUTHOR_NAME: 'Author',
			GIT_AUTHOR_EMAIL: email,
			GIT_COMMITTER_NAME: 'Committer',
			GIT_COMMITTER_EMAIL: 'committer@example.com',
		},
	})
}

/**
 * Маленький настоящий репозиторий: инлайн-комментарии и докблок владельца
 * плюс файл чужого автора, который в корпус попасть не должен.
 */
export function makeRepo(name = 'secret-employer-repo'): string {
	const dir = join(mkdtempSync(join(tmpdir(), 'thinks-repo-')), name)

	execFileSync('git', ['init', '-q', dir], { stdio: 'ignore' })

	writeFileSync(
		join(dir, 'retry.ts'),
		[
			'// Сервер отвечает 503, пока прогревает кеш, поэтому повторяем',
			'// запрос, а не показываем ошибку сразу.',
			'const RETRIES = 3',
			'',
			'/**',
			' * Ждёт, пока сервис поднимется, потому что без него старт бессмысленен.',
			' */',
			'export function waitForService() {}',
			'',
			'// Таймаут больше обычного: на холодном старте база отвечает медленно.',
			'const TIMEOUT = 30_000',
		].join('\n'),
	)

	git(dir, ['add', '.'], REPO_OWNER_EMAIL)
	git(dir, ['commit', '-qm', 'mine'], REPO_OWNER_EMAIL)

	writeFileSync(join(dir, 'theirs.ts'), ['// Чужой комментарий про конфиг.', 'const x = 1'].join('\n'))
	git(dir, ['add', '.'], 'other@example.com')
	git(dir, ['commit', '-qm', 'theirs'], 'other@example.com')

	return dir
}
