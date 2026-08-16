import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Register } from '../../corpus/types.js'
import { searchTurns } from '../../search/query.js'
import { briefResult, errorResult, renderBrief } from '../brief.js'
import { CORPUS_MISSING, type Corpus, type ToolContext } from '../context.js'
import {
  DEFAULT_EXAMPLES,
  examplesSchema,
  langSchema,
  lengthBounds,
  registerSchema,
} from './shared.js'

export interface WriteInput {
  brief: string
  register?: Register
  lang?: 'ru' | 'en'
  length?: 'short' | 'normal' | 'long'
  examples?: number
}

export function buildWriteBrief(corpus: Corpus, input: WriteInput): string {
  const register = input.register ?? 'dm'
  const limit = input.examples ?? DEFAULT_EXAMPLES

  const examples = searchTurns(corpus.db, input.brief, {
    register,
    lang: input.lang,
    limit,
    ...lengthBounds(corpus.profile, register, input.length),
  })

  return renderBrief({
    task: `Напиши текст по этому заданию: ${input.brief}`,
    register,
    profile: corpus.profile,
    examples,
  })
}

export function registerWriteAsMe(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    'write_as_me',
    {
      title: 'Написать как я',
      description:
        'Готовит всё необходимое, чтобы написать текст голосом владельца ' +
        'архива: измеренный стиль-профиль, его настоящие сообщения по теме ' +
        'запроса, числовые ограничения и формат ответа. ' +
        'ВАЖНО: инструмент возвращает не готовый текст, а бриф — писать по ' +
        'нему должна вызывающая модель. Используй, когда нужно сочинить ' +
        'сообщение, пост или ответ от лица владельца.',
      inputSchema: {
        brief: z
          .string()
          .min(1)
          .describe('Что нужно написать: тема, суть, кому и зачем.'),
        register: registerSchema.optional(),
        lang: langSchema.optional(),
        length: z
          .enum(['short', 'normal', 'long'])
          .optional()
          .describe('Желаемый объём относительно обычного для этого регистра.'),
        examples: examplesSchema.optional(),
      },
    },
    async (args: WriteInput) => {
      const corpus = ctx.corpus.get()
      if (!corpus) return errorResult(CORPUS_MISSING)
      return briefResult(buildWriteBrief(corpus, args))
    }
  )
}
