import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildCodeCorpus } from '#thinks/code/build'
import { loadConfig, type Config } from '#thinks/config'
import { buildCorpus } from '#thinks/corpus/build'

import { makeDump } from './fixtures.ts'
import { makeRepo, REPO_OWNER_EMAIL } from './repo.ts'

/** Пустой каталог данных: корпуса ещё нет. */
export const emptyConfig = (): Config => loadConfig({ THINKS_DATA_DIR: mkdtempSync(join(tmpdir(), 'thinks-empty-')) })

/** Корпус переписки из фикстуры, а с `code` ещё и корпус комментариев из маленького репозитория. */
export function seededConfig({ code = false } = {}): Config {
	const cfg = { ...emptyConfig(), holdoutSize: 0 }
	const dumpPath = join(cfg.dataDir, 'dump.json')

	writeFileSync(dumpPath, JSON.stringify(makeDump()))
	buildCorpus({ ...cfg, dumpPath })

	if (code) buildCodeCorpus(cfg, [makeRepo()], [REPO_OWNER_EMAIL])

	return cfg
}
