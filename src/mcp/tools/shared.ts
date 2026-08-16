import { z } from 'zod'
import type { Register } from '../../corpus/types.js'
import type { StyleProfile } from '../../style/profile.js'

export const registerSchema = z
  .enum(['dm', 'group', 'longform', 'code', 'jsdoc'])
  .describe(
    'Регистр: dm — личная переписка, group — групповой чат, ' +
      'longform — длинный авторский текст (пост, развёрнутое объяснение), ' +
      'code — инлайн-комментарий в коде, jsdoc — докблок. ' +
      'Для комментариев в коде брать только code или jsdoc: чат-регистры ' +
      'замерены по переписке и в код не годятся.'
  )

export const langSchema = z
  .enum(['ru', 'en'])
  .describe('Язык примеров. Осмысленно для code и jsdoc, где используются оба.')

export const DEFAULT_EXAMPLES = 18

export const examplesSchema = z
  .number()
  .int()
  .min(4)
  .max(40)
  .describe(
    `Сколько примеров подложить в бриф (по умолчанию ${DEFAULT_EXAMPLES}).`
  )

/** Length filters expressed in the owner's own percentiles. */
export function lengthBounds(
  profile: StyleProfile,
  register: Register,
  length: 'short' | 'normal' | 'long' | undefined
): { minChars?: number; maxChars?: number } {
  const m = profile.registers[register]
  if (!m || !length || length === 'normal') return {}
  if (length === 'short') return { maxChars: m.turnLength.median }
  return { minChars: m.turnLength.p75 }
}
