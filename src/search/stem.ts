/**
 * Snowball stemmer for Russian, plus the tokenizer used on both sides of the
 * index.
 *
 * FTS5's unicode61 tokenizer splits Cyrillic correctly but knows no morphology,
 * so "сообщение" and "сообщения" are unrelated tokens to it. Russian inflects
 * heavily enough that searching an archive without stemming misses most of what
 * it should find. Implemented here rather than pulled in as a dependency: the
 * algorithm is ~100 lines and the project otherwise needs nothing but the SDK.
 */

const VOWELS = 'аеиоуыэюя'

const PERFECTIVE_GERUND_1 = ['вшись', 'вши', 'в']
const PERFECTIVE_GERUND_2 = ['ывшись', 'ившись', 'ывши', 'ивши', 'ыв', 'ив']

const ADJECTIVE = [
  'ыми',
  'ими',
  'его',
  'ого',
  'ему',
  'ому',
  'ей',
  'ий',
  'ый',
  'ой',
  'ем',
  'им',
  'ым',
  'ом',
  'их',
  'ых',
  'ую',
  'юю',
  'ая',
  'яя',
  'ою',
  'ею',
  'ее',
  'ие',
  'ые',
  'ое',
]

const PARTICIPLE_1 = ['ющ', 'вш', 'нн', 'ем', 'щ']
const PARTICIPLE_2 = ['ующ', 'ивш', 'ывш']

const REFLEXIVE = ['ся', 'сь']

const VERB_1 = [
  'ейте',
  'уйте',
  'ешь',
  'нно',
  'ете',
  'йте',
  'ла',
  'на',
  'ли',
  'ем',
  'ло',
  'но',
  'ет',
  'ют',
  'ны',
  'ть',
  'й',
  'л',
  'н',
]
const VERB_2 = [
  'ейте',
  'уйте',
  'ила',
  'ыла',
  'ена',
  'ите',
  'или',
  'ыли',
  'ило',
  'ыло',
  'ено',
  'ует',
  'уют',
  'ены',
  'ить',
  'ыть',
  'ишь',
  'ей',
  'уй',
  'ил',
  'ыл',
  'им',
  'ым',
  'ен',
  'ят',
  'ит',
  'ыт',
  'ую',
  'ю',
]

const NOUN = [
  'иями',
  'ями',
  'ами',
  'иях',
  'ией',
  'иям',
  'ием',
  'ях',
  'ах',
  'ов',
  'ев',
  'ие',
  'ье',
  'еи',
  'ии',
  'ей',
  'ой',
  'ий',
  'ям',
  'ем',
  'ам',
  'ом',
  'ию',
  'ью',
  'ия',
  'ья',
  'а',
  'е',
  'и',
  'й',
  'о',
  'у',
  'ы',
  'ь',
  'ю',
  'я',
]

const SUPERLATIVE = ['ейше', 'ейш']
const DERIVATIONAL = ['ость', 'ост']

const isVowel = (ch: string) => VOWELS.includes(ch)

/** Longest match wins, so the ending lists must be probed in order of length. */
function chop(word: string, endings: string[], rvStart: number): string | null {
  for (const e of endings) {
    if (word.length - e.length >= rvStart && word.endsWith(e)) {
      return word.slice(0, word.length - e.length)
    }
  }
  return null
}

/** Same, but the ending must be preceded by "а" or "я" (Snowball group 1). */
function chopAfterAYa(
  word: string,
  endings: string[],
  rvStart: number
): string | null {
  for (const e of endings) {
    const cut = word.length - e.length
    if (cut - 1 >= rvStart && word.endsWith(e)) {
      const before = word[cut - 1]
      if (before === 'а' || before === 'я') return word.slice(0, cut)
    }
  }
  return null
}

/** Index of the first character after the first vowel. */
function rvIndex(word: string): number {
  for (let i = 0; i < word.length; i++) {
    if (isVowel(word[i])) return i + 1
  }
  return word.length
}

/** Start of R2: inside R1, the region after the next vowel-consonant pair. */
function r2Index(word: string): number {
  const afterPair = (from: number): number => {
    let i = from
    while (i < word.length && !isVowel(word[i])) i++
    while (i < word.length && isVowel(word[i])) i++
    return i
  }
  return afterPair(afterPair(0))
}

export function stemRussian(input: string): string {
  let word = input
  if (word.length <= 2) return word

  const rv = rvIndex(word)
  const r2 = r2Index(word)

  // Step 1: perfective gerund, else reflexive + (adjectival | verb | noun).
  let step1 =
    chopAfterAYa(word, PERFECTIVE_GERUND_1, rv) ??
    chop(word, PERFECTIVE_GERUND_2, rv)

  if (step1 === null) {
    word = chop(word, REFLEXIVE, rv) ?? word

    const adjective = chop(word, ADJECTIVE, rv)
    if (adjective !== null) {
      step1 =
        chopAfterAYa(adjective, PARTICIPLE_1, rv) ??
        chop(adjective, PARTICIPLE_2, rv) ??
        adjective
    } else {
      step1 =
        chopAfterAYa(word, VERB_1, rv) ??
        chop(word, VERB_2, rv) ??
        chop(word, NOUN, rv)
    }
  }
  if (step1 !== null) word = step1

  // Step 2: a trailing "и".
  if (word.length - 1 >= rv && word.endsWith('и')) word = word.slice(0, -1)

  // Step 3: a derivational suffix, but only if it sits in R2.
  for (const e of DERIVATIONAL) {
    if (word.endsWith(e) && word.length - e.length >= r2) {
      word = word.slice(0, word.length - e.length)
      break
    }
  }

  // Step 4: doubled н, superlative, soft sign.
  if (word.endsWith('нн')) {
    word = word.slice(0, -1)
  } else {
    const sup = chop(word, SUPERLATIVE, rv)
    if (sup !== null) {
      word = sup.endsWith('нн') ? sup.slice(0, -1) : sup
    } else if (word.endsWith('ь')) {
      word = word.slice(0, -1)
    }
  }

  return word
}

/**
 * Porter stemmer for English, in the reduced form that matters here.
 *
 * 23% of the code corpus is written in English, and without this `comment` and
 * `comments` are unrelated tokens — the same morphology problem Russian has,
 * just milder. Only the suffix steps that affect ordinary prose are
 * implemented; the full algorithm's edge cases buy nothing for search over
 * comments.
 */
export function stemEnglish(input: string): string {
  let word = input
  if (word.length <= 3) return word

  // Plurals and third person.
  if (word.endsWith('sses')) word = word.slice(0, -2)
  else if (word.endsWith('ies')) word = `${word.slice(0, -3)}i`
  else if (word.endsWith('ss')) {
    // keep
  } else if (word.endsWith('s')) word = word.slice(0, -1)

  // Past tense and gerunds, but only when a vowel survives in the stem.
  const hasVowel = (s: string) => /[aeiouy]/.test(s)
  if (word.endsWith('eed')) {
    if (measureOf(word.slice(0, -3)) > 0) word = word.slice(0, -1)
  } else if (word.endsWith('ed') && hasVowel(word.slice(0, -2))) {
    word = tidy(word.slice(0, -2))
  } else if (word.endsWith('ing') && hasVowel(word.slice(0, -3))) {
    word = tidy(word.slice(0, -3))
  }

  if (word.endsWith('y') && hasVowel(word.slice(0, -1))) {
    word = `${word.slice(0, -1)}i`
  }

  for (const [suffix, replacement] of ENGLISH_SUFFIXES) {
    if (word.endsWith(suffix) && measureOf(word.slice(0, -suffix.length)) > 0) {
      word = word.slice(0, -suffix.length) + replacement
      break
    }
  }

  // Porter step 5a: drop a final `e` unless doing so would leave a stem that
  // still needs it. Without the second clause "cache" keeps its `e` while
  // "caching" loses it, and the two never match.
  if (word.endsWith('e')) {
    const stem = word.slice(0, -1)
    const m = measureOf(stem)
    if (m > 1 || (m === 1 && !endsCVC(stem))) word = stem
  }

  return word
}

/** Consonant-vowel-consonant ending, where the last is not w, x or y. */
function endsCVC(stem: string): boolean {
  if (stem.length < 3) return false
  const [a, b, c] = stem.slice(-3)
  const vowel = (ch: string) => 'aeiou'.includes(ch)
  return !vowel(a) && vowel(b) && !vowel(c) && !'wxy'.includes(c)
}

const ENGLISH_SUFFIXES: [string, string][] = [
  ['ational', 'ate'],
  ['tional', 'tion'],
  ['ization', 'ize'],
  ['fulness', 'ful'],
  ['ousness', 'ous'],
  ['iveness', 'ive'],
  ['ableness', 'able'],
  ['ation', 'ate'],
  ['alism', 'al'],
  ['aliti', 'al'],
  ['iviti', 'ive'],
  ['biliti', 'ble'],
  ['ement', ''],
  ['ment', ''],
  ['ence', ''],
  ['ance', ''],
  ['able', ''],
  ['ible', ''],
  ['ness', ''],
  ['ical', 'ic'],
  ['ful', ''],
  ['ous', ''],
  ['ive', ''],
  ['ize', ''],
  ['er', ''],
  ['li', ''],
]

/** Restore the shape Porter's step 1b leaves behind. */
function tidy(stem: string): string {
  if (/(at|bl|iz)$/.test(stem)) return `${stem}e`
  if (/([^aeiouylsz])\1$/.test(stem)) return stem.slice(0, -1)
  return stem
}

/** Porter's m: the number of vowel-consonant sequences in a stem. */
function measureOf(stem: string): number {
  const shape = stem.replace(/[aeiou]+/g, 'V').replace(/[^V]+/g, 'C')
  return (shape.match(/VC/g) ?? []).length
}

const WORD_RE = /[\p{L}\p{N}]+/gu
const CYRILLIC_RE = /[а-яё]/
const LATIN_RE = /^[a-z]+$/

/** Split text into normalized, stemmed tokens. Used for indexing and querying. */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const match of text.toLowerCase().replace(/ё/g, 'е').matchAll(WORD_RE)) {
    const word = match[0]
    if (word.length < 2) continue
    if (CYRILLIC_RE.test(word)) out.push(stemRussian(word))
    else if (LATIN_RE.test(word)) out.push(stemEnglish(word))
    else out.push(word)
  }
  return out
}

/** The string stored in the FTS columns. */
export function stemsOf(text: string): string {
  return tokenize(text).join(' ')
}
