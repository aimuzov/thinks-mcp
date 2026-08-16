import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Register } from '../../corpus/types.js'
import { searchTurns } from '../../search/query.js'
import { briefResult, errorResult, renderBrief } from '../brief.js'
import { CORPUS_MISSING, type Corpus, type ToolContext } from '../context.js'
import { DEFAULT_EXAMPLES, examplesSchema, registerSchema } from './shared.js'

export interface RephraseInput {
  text: string
  register?: Register
  examples?: number
}

export function buildRephraseBrief(
  corpus: Corpus,
  input: RephraseInput
): string {
  const register = input.register ?? 'dm'
  const limit = input.examples ?? DEFAULT_EXAMPLES

  const examples = searchTurns(corpus.db, input.text, { register, limit })

  return renderBrief({
    task:
      'Перепиши этот текст так, будто его с самого начала написал владелец ' +
      `архива:\n\n${input.text}`,
    register,
    profile: corpus.profile,
    examples,
    extraConstraints: [
      'Смысл и все факты сохрани полностью — меняется только голос.',
      'Ничего не добавляй от себя и не выбрасывай существенное.',
      'Если исходник заметно длиннее моей обычной реплики — сокращай, ' +
        'а не пересказывай близко к тексту.',
    ],
  })
}

export function registerRephraseAsMe(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    'rephrase_as_me',
    {
      title: 'Переформулировать как я',
      description:
        'Готовит бриф для переписывания готового текста голосом владельца ' +
        'архива с сохранением смысла. ВАЖНО: возвращает бриф, а не ' +
        'переписанный текст. Используй, когда текст уже есть, но звучит ' +
        'не как владелец.',
      inputSchema: {
        text: z
          .string()
          .min(1)
          .describe('Текст, который нужно переформулировать.'),
        register: registerSchema.optional(),
        examples: examplesSchema.optional(),
      },
    },
    async (args: RephraseInput) => {
      const corpus = ctx.corpus.get()
      if (!corpus) return errorResult(CORPUS_MISSING)
      return briefResult(buildRephraseBrief(corpus, args))
    }
  )
}
