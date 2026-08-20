import { run, type Db } from '../store/db.js'
import type { CachedFile, ScanCache } from './scan.js'

/**
 * Blame results kept between builds, keyed by the file's blob hash.
 *
 * Rebuilding the code corpus otherwise costs a minute and a half of `git blame`
 * to rediscover comments that have not changed since the last run. Entries are
 * read into memory up front — a few thousand rows — and written back in one
 * transaction, so a rebuild does not turn into thousands of small queries.
 */
export class BlameCache implements ScanCache {
  private readonly entries = new Map<string, CachedFile>()
  private readonly dirty = new Set<string>()

  constructor(private readonly db: Db) {
    const rows = db
      .prepare('SELECT repo, path, blob, comments FROM blame_cache')
      .all() as unknown as {
      repo: string
      path: string
      blob: string
      comments: string
    }[]

    for (const row of rows) {
      this.entries.set(keyOf(row.repo, row.path), {
        blob: row.blob,
        comments: JSON.parse(row.comments),
      })
    }
  }

  get(repo: string, path: string): CachedFile | undefined {
    return this.entries.get(keyOf(repo, path))
  }

  set(repo: string, path: string, entry: CachedFile): void {
    const key = keyOf(repo, path)
    this.entries.set(key, entry)
    this.dirty.add(key)
  }

  get size(): number {
    return this.entries.size
  }

  /** Persist what changed. Call once, after every repository is scanned. */
  flush(): void {
    if (!this.dirty.size) return

    const upsert = this.db.prepare(
      'INSERT INTO blame_cache (repo, path, blob, comments) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(repo, path) DO UPDATE SET ' +
        'blob = excluded.blob, comments = excluded.comments'
    )

    run(this.db, 'BEGIN')
    try {
      for (const key of this.dirty) {
        const entry = this.entries.get(key)
        if (!entry) continue
        const [repo, path] = splitKey(key)
        upsert.run(repo, path, entry.blob, JSON.stringify(entry.comments))
      }
      run(this.db, 'COMMIT')
    } catch (err) {
      run(this.db, 'ROLLBACK')
      throw err
    }
    this.dirty.clear()
  }
}

// The key is a JSON pair rather than a joined string: a path may contain
// any separator character one might pick, and a wrong split would write
// the entry back under a truncated path.
const keyOf = (repo: string, path: string) => JSON.stringify([repo, path])
const splitKey = (key: string) => JSON.parse(key) as [string, string]
