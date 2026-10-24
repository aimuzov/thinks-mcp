import { buildCorpus } from '#thinks/corpus/build'

import { Users } from './users.ts'

/**
 * One corpus build, run as a child process of the server.
 *
 * A build holds the whole export in memory, several times its size on disk.
 * In its own process it gets its own heap limit, and running out of it kills
 * the build instead of the server everyone is connected to.
 *
 * Usage: buildWorker.js <data dir> <user id> <dump path> <target db path>
 */
const [dataDir, userId, dumpPath, dbPath] = process.argv.slice(2)
if (!dataDir || !userId || !dumpPath || !dbPath) {
	console.error('usage: buildWorker.js <data dir> <user id> <dump> <db>')
	process.exit(2)
}

try {
	const cfg = { ...new Users(dataDir).config(userId), dumpPath, dbPath }
	buildCorpus(cfg, (msg) => console.error(msg), {
		expectOwnerId: `user${userId}`,
	})
} catch (err) {
	console.error(err instanceof Error ? err.message : err)
	process.exit(1)
}
