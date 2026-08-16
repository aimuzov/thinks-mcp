import type { CodeMetrics } from './codeMetrics.js'

const pct = (share: number) => `${Math.round(share * 1000) / 10}%`

/**
 * Render the code half of the profile.
 *
 * Deliberately not the chat renderer with different numbers: a comment has no
 * emoji palette, no "period at the end" habit and no burst rhythm, while it
 * does have a line width, markers and an obligation to explain a reason. Reusing
 * the chat text here would hand a model instructions that read as authoritative
 * and are wrong for the genre.
 */
export function renderCodeProfile(
  code: CodeMetrics,
  register: 'code' | 'jsdoc',
  opts: { full?: boolean } = {}
): string {
  const lines: string[] = []
  const isDoc = register === 'jsdoc'
  const sizes = code.genres[register]

  lines.push(
    `# Как я комментирую код — ${isDoc ? 'JSDoc' : 'инлайн'}`,
    '',
    `Замерено по ${sizes.blocks.toLocaleString('ru')} блокам этого жанра ` +
      `(всего в корпусе ${code.blocks.toLocaleString('ru')} из моих репозиториев).`,
    ''
  )

  lines.push('## Размер')
  lines.push(
    `- Строка комментария: медиана ${sizes.lineWidth.median} символов, ` +
      `90% короче ${sizes.lineWidth.p90}.`
  )
  lines.push(
    `- Однострочных блоков — ${pct(sizes.blockLines.oneLiners)}: если сказать ` +
      'нечего сверх одной фразы, одной строкой и ограничиваюсь.'
  )
  lines.push(
    `- Когда объясняю развёрнуто — медиана ${sizes.blockLines.medianMulti} строк, ` +
      `90% блоков короче ${sizes.blockLines.p90}.`
  )
  lines.push('')

  lines.push('## Язык')
  lines.push(
    `- По-русски написано ${pct(sizes.russian)} комментариев этого жанра. ` +
      'Язык выбирается по файлу, а не по привычке: как вокруг — так и пишу.'
  )
  lines.push('')

  if (code.connectives.length) {
    lines.push('## Как я объясняю')
    lines.push(
      '- Комментарий отвечает на «почему», и это видно по связкам причинности. ' +
        'Частота в моих блоках:'
    )
    for (const c of code.connectives.slice(0, opts.full ? 12 : 6)) {
      lines.push(`  - «${c.phrase}» — ${c.count} (${pct(c.share)})`)
    }
    lines.push('')
  }

  const used = code.markers.filter(m =>
    ['TODO', 'HACK', 'NOTE', 'REVIEW'].includes(m.name)
  )
  const foreign = code.markers.filter(m =>
    ['FIXME', 'XXX', 'WARN'].includes(m.name)
  )
  if (used.length || foreign.length) {
    lines.push('## Маркеры')
    if (used.length) {
      lines.push(
        `- Пользуюсь только этими: ${used.map(m => `${m.name} (${m.count})`).join(', ')}.`
      )
    }
    lines.push(
      foreign.length
        ? `- FIXME/XXX/WARN почти не встречаются: ${foreign
            .map(m => `${m.name} — ${m.count}`)
            .join(', ')}.`
        : '- FIXME, XXX и WARN не использую вовсе.'
    )
    lines.push('')
  }

  if (opts.full && code.repos.length) {
    // Names are pseudonyms by the time they get here; only the spread is
    // informative — it says whether the corpus rests on one project or many.
    lines.push('## Откуда корпус')
    lines.push(
      `- ${code.repos.length} репозиториев, крупнейший даёт ` +
        `${Math.round((code.repos[0].blocks / code.blocks) * 100)}% блоков.`
    )
    lines.push('')
  }

  return lines.join('\n')
}

/** Numeric constraints for the CONSTRAINTS block of a code brief. */
export function codeConstraints(
  code: CodeMetrics,
  register: 'code' | 'jsdoc'
): string[] {
  const sizes = code.genres[register]
  const out = [
    `Строка комментария — не длиннее ${sizes.lineWidth.p90} символов ` +
      `(медиана ${sizes.lineWidth.median}). Переносить по смыслу, а не по ширине.`,
    `Однострочный блок — норма (${pct(sizes.blockLines.oneLiners)}). ` +
      `Если объясняешь развёрнуто — ${sizes.blockLines.medianMulti} строк, ` +
      `не больше ${sizes.blockLines.p90}.`,
  ]

  if (register === 'jsdoc') {
    out.push(
      'Первая строка — одно предложение с точкой, дальше пустая `*` и абзацы.',
      '`@param name - Описание.` без типа в фигурных скобках — типы даёт TypeScript.',
      'Не использовать `@function`, `@memberof`, `@returns {Type}`, `@param {Type}`.'
    )
  } else {
    out.push(
      'Полное предложение — с точкой. Короткий ярлык над блоком — без точки.',
      'Маркеры только эти четыре: TODO, HACK, NOTE, REVIEW. Формат `// МАРКЕР: Текст.`'
    )
  }

  out.push(
    'Комментарий отвечает на «почему», «что сломается иначе» или «какой внешний ' +
      'факт вынудил». Пересказ кода запрещён.',
    'Причину не выдумывать: нет подтверждения — писать только проверяемый факт ' +
      'либо TODO с честной формулировкой незнания.',
    `Язык — как в остальных комментариях файла (по корпусу: ${Math.round(code.russian * 100)}% по-русски).`,
    'Ни эмодзи, ни markdown-заголовков, ни «✅/❌» внутри комментариев.'
  )

  return out
}
