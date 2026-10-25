import { failure, text } from '@aimuzov/infra-mcp-kit'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { Register } from '#thinks/corpus/types'
import { renderBrief } from '#thinks/mcp/brief'
import { type Corpus, type ToolContext } from '#thinks/mcp/context'
import { searchTurns } from '#thinks/search/query'

import { DEFAULT_EXAMPLES, examplesSchema, registerSchema } from './shared.ts'

export type RephraseInput = {
	text: string
	register?: Register
	examples?: number
}

export function buildRephraseBrief(corpus: Corpus, input: RephraseInput): string {
	const register = input.register ?? 'dm'
	const limit = input.examples ?? DEFAULT_EXAMPLES

	const examples = searchTurns(corpus.db, input.text, { register, limit })

	return renderBrief({
		task: 'Перепиши этот текст так, будто его с самого начала написал владелец ' + `архива:\n\n${input.text}`,
		register,
		profile: corpus.profile,
		examples,
		extraConstraints: [
			'Смысл и все факты сохрани полностью -- меняется только голос.',
			'Ничего не добавляй от себя и не выбрасывай существенное.',
			'Если исходник заметно длиннее моей обычной реплики -- сокращай, ' + 'а не пересказывай близко к тексту.',
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
				text: z.string().min(1).describe('Текст, который нужно переформулировать.'),
				register: registerSchema.optional(),
				examples: examplesSchema.optional(),
			},
		},
		async (args: RephraseInput) => {
			const corpus = ctx.corpus.get()

			if (!corpus) return failure(ctx.corpus.missing())

			return text(buildRephraseBrief(corpus, args))
		},
	)
}
