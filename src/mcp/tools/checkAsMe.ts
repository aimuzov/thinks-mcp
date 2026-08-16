import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Register } from '../../corpus/types.js'
import { checkText, renderCheck } from '../../style/check.js'
import { briefResult, errorResult } from '../brief.js'
import { CORPUS_MISSING, type ToolContext } from '../context.js'
import { registerSchema } from './shared.js'

export interface CheckInput {
  text: string
  register?: Register
  code?: string
}

export function registerCheckAsMe(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    'check_as_me',
    {
      title: 'Проверить, похоже ли на меня',
      description:
        'Сверяет готовый текст с измеренным профилем владельца архива и ' +
        'возвращает оценку 0–100 и список конкретных отклонений: длина, ' +
        'канцелярит, чужие эмодзи, списки, нетипичная пунктуация. ' +
        'Проверка детерминированная, без модели. Вызывай после того, как ' +
        'написал текст по брифу от write_as_me, reply_as_me или ' +
        'rephrase_as_me, и переписывай текст, пока оценка не станет высокой.',
      inputSchema: {
        text: z
          .string()
          .min(1)
          .describe(
            'Проверяемый текст. Если это несколько сообщений — по одному на строку.'
          ),
        register: registerSchema.optional(),
        code: z
          .string()
          .optional()
          .describe(
            'Код, который комментируешь. Передавай для register code и jsdoc: ' +
              'тогда проверка поймает пересказ кода — главный запрет, который ' +
              'иначе не виден.'
          ),
      },
    },
    async (args: CheckInput) => {
      const corpus = ctx.corpus.get()
      if (!corpus) return errorResult(CORPUS_MISSING)

      const report = checkText(
        args.text,
        corpus.profile,
        args.register ?? 'dm',
        args.code
      )
      return {
        ...briefResult(renderCheck(report)),
        structuredContent: report as unknown as Record<string, unknown>,
      }
    }
  )
}
