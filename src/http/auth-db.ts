import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

/**
 * Bring an auth.db written before the kit up to the kit's schema.
 *
 * The client table is the same, so registered clients survive and nobody has to
 * reconnect. Pending codes used to keep the user id in a column of their own; the
 * kit keeps a signed grant instead, and `CREATE TABLE IF NOT EXISTS` would leave
 * the old table in place. Codes live five minutes, so dropping them costs at most
 * a login that was half-way through during the deploy.
 */
export function migrateAuthDb(path: string): void {
	if (!existsSync(path)) return

	const db = new DatabaseSync(path)

	try {
		const columns = db.prepare("SELECT name FROM pragma_table_info('auth_code')").all() as { name: string }[]

		if (columns.some((c) => c.name === 'user_id')) db.prepare('DROP TABLE auth_code').run()
	} finally {
		db.close()
	}
}
