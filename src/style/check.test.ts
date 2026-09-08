import { describe, expect, it } from 'vitest'
import { checkText, codeOverlap } from './check.js'
import type { StyleProfile } from './profile.js'
import type { RegisterMetrics } from './metrics.js'

const dm: RegisterMetrics = {
  turns: 1000,
  messages: 1600,
  messageLength: {
    count: 1600,
    mean: 35,
    p25: 9,
    median: 18,
    p75: 32,
    p90: 52,
    max: 900,
  },
  turnLength: {
    count: 1000,
    mean: 50,
    p25: 12,
    median: 25,
    p75: 55,
    p90: 94,
    max: 1200,
  },
  punctuation: {
    startsCapital: 0.984,
    endsPeriod: 0.649,
    endsQuestion: 0.193,
    endsExclamation: 0.015,
    endsParen: 0.05,
    endsNothing: 0.092,
    hasQuestion: 0.21,
    hasExclamation: 0.022,
    hasEllipsis: 0.012,
    hasDash: 0.01,
  },
  bursts: {
    single: 0.631,
    double: 0.233,
    triple: 0.083,
    more: 0.053,
    messagesInBursts: 0.605,
    meanParts: 1.6,
  },
  emoji: [
    { char: '🙂', count: 7640 },
    { char: 'ツ', count: 639 },
    { char: '😄', count: 607 },
  ],
}

const profile: StyleProfile = {
  builtAt: '2026-08-11T00:00:00.000Z',
  registers: { dm, group: dm, longform: dm },
  recent: {},
  recentFrom: 0,
  markers: [],
  antiPatterns: [
    { label: 'списки через дефис', hits: 80, share: 0.05 },
    { label: 'нумерованные списки', hits: 30, share: 0.019 },
    { label: 'markdown-жирный **', hits: 8, share: 0.005 },
  ],
}

const check = (text: string) => checkText(text, profile)
const issues = (text: string) => check(text).findings.map(f => f.issue)

describe('checkText', () => {
  it('passes a message written the way the profile describes', () => {
    const report = check('Через час буду.\nМожет раньше.')
    expect(report.findings).toEqual([])
    expect(report.score).toBe(100)
  })

  it('flags a message far over the length ceiling', () => {
    const report = check('А'.repeat(400))
    expect(issues('А'.repeat(400))).toContain(
      'Сообщение длиннее, чем я обычно пишу'
    )
    expect(report.score).toBeLessThan(70)
  })

  it('flags bullet lists and markdown', () => {
    const found = issues('Смотри:\n- первое\n- второе\nи **важное**')
    expect(found).toContain('Список — я так не пишу')
    expect(found).toContain('Markdown-разметка')
  })

  it('lets lists through for an author who writes them', () => {
    const listy: StyleProfile = {
      ...profile,
      antiPatterns: [{ label: 'списки через дефис', hits: 5000, share: 3.1 }],
    }
    const found = checkText('Смотри:\n- первое\n- второе', listy).findings
    expect(found.map(f => f.issue)).not.toContain('Список — я так не пишу')
  })

  it('does not assert formatting habits that were never measured', () => {
    const unmeasured: StyleProfile = { ...profile, antiPatterns: [] }
    const found = checkText('- первое\n**второе**', unmeasured).findings
    expect(found.map(f => f.issue)).not.toContain('Список — я так не пишу')
    expect(found.map(f => f.issue)).not.toContain('Markdown-разметка')
  })

  it('flags clerical language with the offending fragment', () => {
    const report = check('Однако решение принято.')
    const clerical = report.findings.find(f => f.issue === 'Канцелярит')
    expect(clerical?.fragment?.toLowerCase()).toBe('однако')
  })

  it('flags emoji outside the palette', () => {
    expect(issues('Готово 👍')).toContain('Эмодзи не из моей палитры')
    expect(issues('Готово 🙂')).not.toContain('Эмодзи не из моей палитры')
  })

  it('flags a wall of exclamation marks', () => {
    expect(issues('Ура!\nОтлично!\nСупер!')).toContain(
      'Слишком много восклицательных знаков'
    )
  })

  it('flags lowercase openings when the owner capitalises', () => {
    expect(issues('привет.\nкак дела.')).toContain(
      'Сообщения начинаются со строчной буквы'
    )
  })

  it('never scores outside 0..100', () => {
    const awful = check(
      ['Однако'.repeat(200), '- список', '**жирный**', 'Ура! 👍😍🎉'].join('\n')
    )
    expect(awful.score).toBeGreaterThanOrEqual(0)
    expect(awful.score).toBeLessThanOrEqual(100)
  })

  it('reports nothing to check for empty input', () => {
    expect(check('   ').score).toBe(0)
    expect(check('   ').verdict).toBe('Проверять нечего.')
  })
})

const typed = (shares: Record<string, number>): StyleProfile => ({
  ...profile,
  typography: Object.entries(shares).map(([label, share]) => ({
    label,
    hits: 1,
    share,
  })),
})

describe('checkText on typography', () => {
  it('flags a mark the archive almost never carries', () => {
    const found = checkText(
      'Плов — пусть готовит.',
      typed({ 'длинное тире —': 1.1 }),
      'dm'
    ).findings
    expect(found.map(f => f.issue)).toContain('Знак не из моего набора')
    expect(found[0].fragment).toBe('—')
    expect(found[0].detail).toContain('1.1%')
  })

  it('lets a mark through for an author who types it', () => {
    const found = checkText(
      'Плов — пусть готовит.',
      typed({ 'длинное тире —': 4.3 }),
      'dm'
    ).findings
    expect(found.map(f => f.issue)).not.toContain('Знак не из моего набора')
  })

  it('says nothing about marks that were never measured', () => {
    const found = checkText('Он сказал «нет» — и ушёл.', profile, 'dm').findings
    expect(found.map(f => f.issue)).not.toContain('Знак не из моего набора')
  })

  it('never holds the double hyphen against a text', () => {
    const found = checkText(
      'Пишу так -- и всё.',
      typed({ 'двойной дефис --': 0 }),
      'dm'
    ).findings
    expect(found.map(f => f.issue)).not.toContain('Знак не из моего набора')
  })
})

const withCode: StyleProfile = {
  ...profile,
  code: {
    blocks: 100,
    lines: 200,
    genres: {
      code: {
        blocks: 60,
        lineWidth: { median: 63, p75: 75, p90: 87, max: 120 },
        blockLines: { median: 1, medianMulti: 3, p90: 5, oneLiners: 0.6 },
        russian: 0.77,
      },
      jsdoc: {
        blocks: 40,
        lineWidth: { median: 60, p75: 72, p90: 84, max: 110 },
        blockLines: { median: 3, medianMulti: 4, p90: 9, oneLiners: 0.1 },
        russian: 0.8,
      },
    },
    inline: 60,
    doc: 40,
    russian: 0.77,
    markers: [
      { name: 'TODO', count: 30, share: 0.3 },
      { name: 'NOTE', count: 5, share: 0.05 },
      { name: 'FIXME', count: 1, share: 0.01 },
    ],
    connectives: [],
    repos: [],
  },
}

const checkCode = (text: string, register: 'code' | 'jsdoc' = 'code') =>
  checkText(text, withCode, register)

describe('checkText for comments', () => {
  it('accepts a comment that follows the measured shape', () => {
    const report = checkCode('// Так сделано потому что иначе ломается сборка.')
    expect(report.findings).toEqual([])
    expect(report.score).toBe(100)
  })

  it('measures width without the comment marker', () => {
    // 84 characters of text: under the 87 ceiling once `// ` is stripped, over
    // it if the marker were counted.
    expect(checkCode(`// ${'а'.repeat(84)}`).findings).toEqual([])
    expect(
      checkCode(`// ${'а'.repeat(100)}`).findings.map(f => f.issue)
    ).toContain('Строка шире, чем я обычно пишу')
  })

  it('flags markers the corpus does not rely on', () => {
    const found = checkCode('// FIXME: почини').findings
    expect(found.map(f => f.issue)).toContain('Чужой маркер')
    expect(found[0].detail).toBe('я использую только TODO, NOTE')
    expect(checkCode('// XXX: почини').findings.map(f => f.issue)).toContain(
      'Чужой маркер'
    )
    expect(checkCode('// TODO: доделать').findings).toEqual([])
  })

  it('stays quiet about markers when the corpus has none', () => {
    const noMarkers: StyleProfile = {
      ...withCode,
      code: { ...withCode.code!, markers: [] },
    }
    expect(checkText('// FIXME: почини', noMarkers, 'code').findings).toEqual(
      []
    )
  })

  it('flags водянистые announcements', () => {
    const found = checkCode('// Этот метод отвечает за обработку данных.')
    expect(found.findings.map(f => f.issue)).toContain('Вода вместо факта')
  })

  it('flags a type in braces inside jsdoc', () => {
    const found = checkCode(
      ['/**', ' * Что-то.', ' * @param {string} name - Имя.', ' */'].join('\n'),
      'jsdoc'
    )
    expect(found.findings.map(f => f.issue)).toContain('Тип в фигурных скобках')
  })

  it('uses the jsdoc block budget, not the inline one', () => {
    // Seven lines: normal for a docblock (p90 = 9), too long for an inline
    // note (p90 = 5).
    const seven = [
      '/**',
      ' * Раз.',
      ' * Два.',
      ' * Три.',
      ' * Четыре.',
      ' * Пять.',
      ' * Шесть.',
      ' * Семь.',
      ' */',
    ].join('\n')
    expect(checkCode(seven, 'jsdoc').findings).toEqual([])
    expect(checkCode(seven, 'code').findings.map(f => f.issue)).toContain(
      'Блок длиннее обычного'
    )
  })

  it('flags emoji, which never appear in the code corpus', () => {
    expect(checkCode('// Готово 🙂').findings.map(f => f.issue)).toContain(
      'Эмодзи в комментарии'
    )
  })

  it('catches a comment that restates the code under it', () => {
    const restating = checkText(
      '// set retry timeout',
      withCode,
      'code',
      'function setRetryTimeout(retry, timeout) {'
    )
    expect(restating.findings.map(f => f.issue)).toContain('Пересказ кода')

    const explaining = checkText(
      '// Иначе поздний ответ перезапишет свежий.',
      withCode,
      'code',
      'const retryTimeout = DEFAULT_RETRY_TIMEOUT'
    )
    expect(explaining.findings.map(f => f.issue)).not.toContain('Пересказ кода')
  })

  it('splits identifiers before comparing, so camelCase counts', () => {
    expect(codeOverlap('cache retry', 'const cacheRetry = 1')).toBe(1)
  })

  it('keeps UPPER_CASE constants whole', () => {
    // Splitting before every capital would turn DEFAULT_TIMEOUT into single
    // letters and drop both words from the comparison.
    expect(codeOverlap('default timeout', 'x = DEFAULT_TIMEOUT')).toBe(1)
  })

  it('scores zero when comment and code are in different languages', () => {
    // The limitation is real and worth pinning: a Russian comment over English
    // identifiers cannot be judged by word overlap, so the detector stays quiet
    // rather than pretending.
    expect(codeOverlap('Кеш и ретрай', 'const cacheRetry = 1')).toBe(0)
    expect(
      checkText(
        '// Определяем платформу и возвращаем платформу.',
        withCode,
        'code',
        'function detectPlatform(): Platform {'
      ).findings.map(f => f.issue)
    ).not.toContain('Пересказ кода')
  })

  it('ignores the code argument for chat registers', () => {
    const report = checkText('Буду.', profile, 'dm', 'const a = 1')
    expect(report.findings).toEqual([])
  })

  it('says so when the code corpus has not been built', () => {
    const report = checkText('// Что угодно.', profile, 'code')
    expect(report.verdict).toBe('Корпус кода не собран.')
  })

  it('takes typography from the code corpus, not from the chat one', () => {
    // The archive's messages hold no `«»` and its comments hold no dash: each
    // register answers for itself, or the chat numbers would ban a dash the
    // author does write in code.
    const mixed: StyleProfile = {
      ...withCode,
      typography: [{ label: 'длинное тире —', hits: 1, share: 1.1 }],
      code: {
        ...withCode.code!,
        typography: {
          jsdoc: [
            { label: 'кавычки-ёлочки «»', hits: 0, share: 0 },
            { label: 'длинное тире —', hits: 300, share: 4.3 },
          ],
        },
      },
    }

    const doc = ['/**', ' * Ставлю «ёлочки» — и тире.', ' */'].join('\n')
    const found = checkText(doc, mixed, 'jsdoc').findings
    const marks = found.filter(f => f.issue === 'Знак не из моего набора')
    expect(marks.map(f => f.fragment)).toEqual(['«'])
  })
})
