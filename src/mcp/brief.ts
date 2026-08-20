import { isCodeRegister, type Register } from '../corpus/types.js'
import type { TurnRow } from '../search/query.js'
import {
  constraintsOf,
  renderProfile,
  type StyleProfile,
} from '../style/profile.js'

export interface BriefInput {
  /** What the caller has to produce, phrased as an instruction. */
  task: string
  register: Register
  profile: StyleProfile
  examples: TurnRow[]
  /** Extra lines appended to CONSTRAINTS. */
  extraConstraints?: string[]
  /** Overrides the default output contract. */
  outputContract?: string
}

const REGISTER_LABEL: Record<Register, string> = {
  dm: 'личная переписка',
  group: 'групповой чат',
  longform: 'длинный авторский текст',
  code: 'инлайн-комментарий',
  jsdoc: 'JSDoc',
}

function renderExample(row: TurnRow, n: number): string {
  const lines: string[] = []
  const register = row.register as Register
  const where = REGISTER_LABEL[row.longform ? 'longform' : register]

  if (isCodeRegister(register)) {
    // A comment is only judgeable against the code it sits above.
    lines.push(`[${n}] ${where}, ${row.chatKey ?? ''} ${row.year}`.trimEnd())
    lines.push('  Комментарий:')
    for (const part of row.parts) lines.push(`    ${part}`)
    if (row.contextIn) lines.push(`  Над кодом: ${row.contextIn}`)
    return lines.join('\n')
  }

  lines.push(`[${n}] ${where}, ${row.year}`)
  if (row.contextIn) {
    // Quoted and inferred pairs are not equally trustworthy, and a model that
    // cannot tell them apart treats a coincidence as an answer.
    lines.push(
      row.contextExplicit
        ? `  Мне написали (я ответил именно на это): ${row.contextIn}`
        : `  Перед этим написали: ${row.contextIn}`
    )
  }
  lines.push('  Я ответил:')
  for (const part of row.parts) lines.push(`    ${part}`)
  return lines.join('\n')
}

function defaultContract(register: Register): string {
  if (isCodeRegister(register)) {
    return [
      'Выведи только текст комментария, без преамбулы и пояснений.',
      register === 'jsdoc'
        ? 'Оформи как готовый докблок, включая `/**` и `*/`.'
        : 'Каждая строка — с ведущим маркером комментария того языка, для которого пишешь.',
      'Если по коду не видно причины и подтверждения ей нет — не выдумывай: ' +
        'напиши только проверяемый факт или TODO с честной формулировкой незнания.',
    ].join('\n')
  }
  if (register === 'longform') {
    return [
      'Выведи только готовый текст, без преамбулы, пояснений и кавычек.',
      'Не добавляй заголовков и списков, если их нет в примерах.',
    ].join('\n')
  }
  return [
    'Выведи только готовые сообщения, без преамбулы, пояснений и кавычек.',
    'Одно сообщение — одна строка. Если мысль просится на две-три реплики, ' +
      'разбей: так и выглядит обычная переписка.',
    'Не нумеруй сообщения и не подписывай их.',
  ].join('\n')
}

/**
 * Assemble the brief a tool hands back.
 *
 * The server deliberately does not generate anything — it hands the calling
 * model the measured profile plus real messages and lets it write. The risk is
 * that the model reads all this and answers in its own voice anyway, so the
 * brief is built to make that hard: the constraints are numeric, the examples
 * are verbatim, and the contract says what the output must look like. The
 * remaining check is `check_as_me`, which scores the result against the same
 * numbers.
 */
export function renderBrief(input: BriefInput): string {
  const { task, register, profile, examples } = input
  const sections: string[] = []

  sections.push(
    [
      '# ЗАДАЧА',
      '',
      task,
      '',
      'Ниже — как пишет владелец этого архива: сначала измеренный профиль, ' +
        'потом его настоящие сообщения. Пиши так, как пишет он, а не так, ' +
        'как пишешь обычно ты.',
    ].join('\n')
  )

  sections.push(renderProfile(profile, register))

  if (examples.length) {
    const rendered = examples.map((row, i) => renderExample(row, i + 1))
    sections.push(
      [
        '# ПРИМЕРЫ ИЗ АРХИВА',
        '',
        'Это дословные сообщения, а не пересказ. Подражай их длине, ритму и ' +
          'интонации, но не копируй содержание.',
        '',
        rendered.join('\n\n'),
      ].join('\n')
    )
  }

  const constraints = [
    ...constraintsOf(profile, register),
    ...(input.extraConstraints ?? []),
  ]
  if (constraints.length) {
    sections.push(
      ['# ОГРАНИЧЕНИЯ', '', ...constraints.map(c => `- ${c}`)].join('\n')
    )
  }

  sections.push(
    [
      '# ФОРМАТ ОТВЕТА',
      '',
      input.outputContract ?? defaultContract(register),
    ].join('\n')
  )

  return sections.join('\n\n')
}

/** Wrap a brief as an MCP tool result. */
export function briefResult(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

/** Wrap a user-facing error as an MCP tool error result. */
export function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true as const,
  }
}
