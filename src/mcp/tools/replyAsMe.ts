import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Register } from '../../corpus/types.js'
import {
  pairStats,
  searchTurns,
  type PairStats,
  type TurnRow,
} from '../../search/query.js'
import { briefResult, errorResult, renderBrief } from '../brief.js'
import { CORPUS_MISSING, type Corpus, type ToolContext } from '../context.js'
import { DEFAULT_EXAMPLES, examplesSchema, registerSchema } from './shared.js'

export interface ReplyInput {
  incoming: string
  hint?: string
  register?: Register
  examples?: number
}

/** Below this share of turns a register has no reply corpus worth the name. */
const MIN_PAIR_SHARE = 0.05

/**
 * Examples come from the reply pairs: turns whose *incoming* message resembles
 * the one being answered. They are the difference between "writes in their
 * style" and "answers the way they would" — tone depends far more on what was
 * said to someone than on the topic.
 */
export function buildReplyBrief(corpus: Corpus, input: ReplyInput): string {
  const register = input.register ?? 'dm'
  const limit = input.examples ?? DEFAULT_EXAMPLES

  const pairs = searchTurns(corpus.db, input.incoming, {
    register,
    limit,
    matchContext: true,
    requireContext: true,
  })

  // Top up with topically similar turns when the archive has few comparable
  // exchanges, so the brief still shows how he talks about this subject.
  const examples: TurnRow[] = [...pairs]
  if (pairs.length < limit) {
    const seen = new Set(pairs.map(p => p.id))
    for (const row of searchTurns(corpus.db, input.incoming, {
      register,
      limit,
    })) {
      if (examples.length >= limit) break
      if (seen.has(row.id)) continue
      seen.add(row.id)
      examples.push(row)
    }
  }

  const task = input.hint
    ? `Ответь на это сообщение: «${input.incoming}»\n\nСмысл ответа: ${input.hint}`
    : `Ответь на это сообщение так, как ответил бы владелец архива: «${input.incoming}»`

  return renderBrief({
    task,
    register,
    profile: corpus.profile,
    examples,
    extraConstraints: [
      ...pairQuality(examples, limit, pairStats(corpus.db, register)),
      'Отвечай на то, что написано, а не пересказывай сообщение собеседника.',
      'Не здоровайся, если это не начало разговора.',
    ],
  })
}

/**
 * Tell the caller how much the examples are worth.
 *
 * Group chats are the case that forces this: a Telegram export of a supergroup
 * carries almost none of the other participants' messages, so there are no pairs
 * to find and the brief silently falls back to turns that merely share a topic.
 * A model reading those as answers imitates a conversation that never happened.
 */
function pairQuality(
  examples: TurnRow[],
  limit: number,
  stats: PairStats
): string[] {
  const pairs = examples.filter(e => e.contextIn)
  const quoted = pairs.filter(e => e.contextExplicit).length

  // A handful of pairs against thousands of turns is not a corpus of replies,
  // however healthy one search happens to look.
  if (!pairs.length || stats.share < MIN_PAIR_SHARE) {
    return [
      'В архиве для этого регистра почти нет пар «входящее → ответ» — примеры ' +
        'ниже подобраны в основном по теме. Бери из них голос и длину, но не ' +
        'считай их образцами ответа именно на такое сообщение.',
    ]
  }

  const out: string[] = []
  if (pairs.length < limit) {
    out.push(
      `Настоящих пар нашлось ${pairs.length} из ${limit}; остальные примеры ` +
        'подобраны по теме и ответами на это сообщение не являются.'
    )
  }
  if (!quoted) {
    out.push(
      'Все пары ниже восстановлены по порядку сообщений, а не по явной ' +
        'цитате. Иногда это просто следующая реплика, а не ответ — ' +
        'ориентируйся на тон, а не на то, что именно отвечено.'
    )
  }
  return out
}

export function registerReplyAsMe(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    'reply_as_me',
    {
      title: 'Ответить как я',
      description:
        'Готовит бриф для ответа на входящее сообщение голосом владельца ' +
        'архива. Примеры подбираются по похожим входящим сообщениям из ' +
        'реальной переписки — то есть показывает, как он отвечал именно на ' +
        'такое. ВАЖНО: возвращает бриф, а не готовый ответ; ответ пишет ' +
        'вызывающая модель. Используй, когда есть чужое сообщение и нужно ' +
        'на него ответить.',
      inputSchema: {
        incoming: z
          .string()
          .min(1)
          .describe('Текст входящего сообщения, на которое нужно ответить.'),
        hint: z
          .string()
          .optional()
          .describe('Что по смыслу нужно ответить, если это уже решено.'),
        register: registerSchema.optional(),
        examples: examplesSchema.optional(),
      },
    },
    async (args: ReplyInput) => {
      const corpus = ctx.corpus.get()
      if (!corpus) return errorResult(CORPUS_MISSING)
      return briefResult(buildReplyBrief(corpus, args))
    }
  )
}
