import { nextTurnId, run, type Db } from '../store/db.js'
import type { Turn } from '../corpus/types.js'

/**
 * Write turns to the corpus table.
 *
 * The FTS tables are not touched here — they are rebuilt in one pass by
 * `rebuildIndexes` once all writing is done. Contentless FTS5 cannot drop a row
 * without being handed its original text, so incremental upkeep across two
 * independently rebuilt corpora would be a bookkeeping trap; a full rebuild
 * costs a few seconds and cannot drift.
 *
 * Holdout turns are stored but excluded from the rebuild: the blind acceptance
 * test asks the server to answer messages it has genuinely never seen, which
 * only works if they cannot come back as their own example.
 */
export function insertTurns(
  db: Db,
  turns: Turn[],
  holdoutPositions: Set<number>
): void {
  const insertTurn = db.prepare(
    `INSERT INTO turn
       (id, chat_key, register, longform, holdout, lang, ts, year, parts, text,
        n_parts, chars, context_in, context_explicit, context_lag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const base = nextTurnId(db)

  run(db, 'BEGIN')
  try {
    turns.forEach((turn, i) => {
      insertTurn.run(
        base + i,
        turn.chatKey,
        turn.register,
        turn.longform ? 1 : 0,
        holdoutPositions.has(i + 1) ? 1 : 0,
        turn.lang ?? null,
        turn.ts,
        turn.year,
        JSON.stringify(turn.parts),
        turn.text,
        turn.parts.length,
        turn.chars,
        turn.contextIn,
        turn.contextExplicit ? 1 : 0,
        // SQLite binds null but not undefined, and callers building turns by
        // hand leave optional fields off.
        turn.contextLag ?? null
      )
    })
    run(db, 'COMMIT')
  } catch (err) {
    run(db, 'ROLLBACK')
    throw err
  }
}

/**
 * Pick the turns to hold out: reply pairs long enough to be worth judging.
 * Deterministic (every n-th match) so a rebuild reproduces the same test set.
 * Returns 1-based positions in `turns`, not database ids.
 */
export function pickHoldout(turns: Turn[], size: number): Set<number> {
  const eligible: number[] = []
  turns.forEach((turn, i) => {
    if (turn.contextIn && turn.contextIn.length >= 15 && turn.chars >= 15) {
      eligible.push(i + 1)
    }
  })
  if (eligible.length <= size) return new Set(eligible)

  const step = Math.floor(eligible.length / size)
  const picked = new Set<number>()
  for (let i = 0; picked.size < size && i * step < eligible.length; i++) {
    picked.add(eligible[i * step])
  }
  return picked
}
