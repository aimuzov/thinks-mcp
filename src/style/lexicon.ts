export type Counts = Map<string, number>

export interface Marker {
  word: string
  /** Times the owner used it. */
  mine: number
  /** Times everyone else did. */
  theirs: number
  /** Standardised log-odds; higher means "more distinctively theirs". */
  z: number
  /** Owner uses per 10k words. */
  per10k: number
}

const WORD_RE = /[\p{L}]+/gu

/**
 * Count raw words — unstemmed, since a marker like "ага" *is* the word.
 *
 * When `capitalized` is given, mid-sentence capitalised occurrences are counted
 * separately. That ratio is what tells a proper noun from a word: a name is
 * capitalised wherever it appears, so it can be dropped from the markers, which
 * are supposed to describe how the owner writes, not who they write about.
 */
export function countWords(
  text: string,
  into: Counts,
  capitalized?: Counts
): void {
  const normalized = text.replace(/ё/g, 'е').replace(/Ё/g, 'Е')
  let first = true
  for (const match of normalized.matchAll(WORD_RE)) {
    const raw = match[0]
    const w = raw.toLowerCase()
    if (w.length >= 2) {
      into.set(w, (into.get(w) ?? 0) + 1)
      if (capitalized && !first && raw[0] !== w[0]) {
        capitalized.set(w, (capitalized.get(w) ?? 0) + 1)
      }
    }
    first = false
  }
}

/**
 * Rank words by how much more the owner uses them than their interlocutors.
 *
 * Plain frequency is useless here — it just returns "не", "в", "я", which is
 * every Russian speaker. This is the log-odds ratio with an informative Dirichlet
 * prior (Monroe, Colaresi & Quinn 2008), with the pooled corpus as the prior:
 * it discounts words that are simply common and surfaces the ones that are
 * characteristic. The 390k interlocutor messages in the dump make an unusually
 * good background corpus — same topics, same era, same people.
 */
export function markers(
  mine: Counts,
  theirs: Counts,
  opts: {
    minTotal?: number
    limit?: number
    /** Mid-sentence capitalised counts; words mostly capitalised are names. */
    capitalized?: Counts
    /** Extra veto, used to drop redaction placeholders and personal names. */
    exclude?: (word: string) => boolean
  } = {}
): Marker[] {
  const minTotal = opts.minTotal ?? 40
  const limit = opts.limit ?? 60
  const capitalized = opts.capitalized
  const exclude = opts.exclude ?? (() => false)

  const mineTotal = sum(mine)
  const theirsTotal = sum(theirs)
  const pooledTotal = mineTotal + theirsTotal
  if (!mineTotal || !theirsTotal) return []

  const out: Marker[] = []
  for (const [word, y1] of mine) {
    const y2 = theirs.get(word) ?? 0
    if (y1 + y2 < minTotal) continue
    if (capitalized && (capitalized.get(word) ?? 0) / y1 > 0.5) continue
    if (exclude(word)) continue

    // Prior weight for this word, scaled so the whole prior is worth one corpus.
    const a = ((y1 + y2) / pooledTotal) * pooledTotal * 0.01 + 0.5
    const a0 = pooledTotal * 0.01 + 0.5 * mine.size

    const l1 = Math.log((y1 + a) / (mineTotal + a0 - y1 - a))
    const l2 = Math.log((y2 + a) / (theirsTotal + a0 - y2 - a))
    const variance = 1 / (y1 + a) + 1 / (y2 + a)
    const z = (l1 - l2) / Math.sqrt(variance)

    out.push({
      word,
      mine: y1,
      theirs: y2,
      z: Math.round(z * 100) / 100,
      per10k: Math.round((y1 / mineTotal) * 100_000) / 10,
    })
  }

  return out.sort((a, b) => b.z - a.z).slice(0, limit)
}

function sum(counts: Counts): number {
  let total = 0
  for (const n of counts.values()) total += n
  return total
}
