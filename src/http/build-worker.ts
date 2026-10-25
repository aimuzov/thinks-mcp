import { buildCorpus } from '#thinks/corpus/build'

import { Users } from './users.ts'

/**
 * One corpus build, run as a child process of the server.
 *
 * A build holds the whole export in memory, several times its size on disk.
 * In its own process it gets its own heap limit, and running out of it kills
 * the build instead of the server everyone is connected to.
 *
 * Every step buildCorpus reports goes to stdout as one line: the server counts
 * them for the progress in the account. Errors go to stderr.
 *
 * Usage: build-worker.js <data dir> <user id> <dump path> <target db path>
 */
const [dataDir, userId, dumpPath, dbPath] = process.argv.slice(2)

if (!dataDir || !userId || !dumpPath || !dbPath) {
	console.error('usage: build-worker.js <data dir> <user id> <dump> <db>')
	process.exit(2)
}

try {
	const cfg = { ...new Users(dataDir).config(userId), dumpPath, dbPath }

	buildCorpus(cfg, () => process.stdout.write('\n'), {
		expectOwnerId: `user${userId}`,
	})
} catch (err) {
	console.error(err instanceof Error ? err.message : err)
	process.exit(1)
}
