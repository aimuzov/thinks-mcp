import { failure, text } from '@aimuzov/infra-mcp-kit'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { Register } from '#thinks/corpus/types'
import { type ToolContext } from '#thinks/mcp/context'
import { searchTurns } from '#thinks/search/query'

import { langSchema, registerSchema } from './shared.ts'

export type FindInput = {
	query: string
	register?: Register
	lang?: 'ru' | 'en'
	limit?: number
	yearFrom?: number
	matchIncoming?: boolean
}

export function registerFindMyMessages(server: McpServer, ctx: ToolContext) {
	server.registerTool(
		'find_my_messages',
		{
			title: 'Найти мои сообщения',
			description:
				'Ищет по архиву настоящие сообщения владельца: "как я обычно ' +
				'отказываю", "что я писал про переезд". Возвращает найденные ходы ' +
				'целиком, вместе с сообщением, на которое они отвечали. Полезен и ' +
				'сам по себе, и чтобы проверить, что подкладывается в брифы.',
			inputSchema: {
				query: z.string().min(1).describe('Что искать: тема, слова, ситуация.'),
				register: registerSchema.optional(),
				lang: langSchema.optional(),
				limit: z.number().int().min(1).max(50).optional(),
				yearFrom: z.number().int().optional().describe('Искать только начиная с этого года.'),
				matchIncoming: z
					.boolean()
					.optional()
					.describe('Искать по входящим сообщениям собеседников, а не по моим ответам.'),
			},
		},
		async (args: FindInput) => {
			const corpus = ctx.corpus.get()

			if (!corpus) return failure(ctx.corpus.missing())

			const rows = searchTurns(corpus.db, args.query, {
				register: args.register,
				lang: args.lang,
				limit: args.limit ?? 15,
				yearFrom: args.yearFrom,
				matchContext: args.matchIncoming,
				requireContext: args.matchIncoming,
			})

			if (!rows.length) return text('Ничего не нашлось.')

			const rendered = rows.map((row, i) => {
				const head = `[${i + 1}] ${row.register}${row.longform ? ', длинный' : ''}, ${row.year}`
				const context = row.contextIn ? `\n  Мне написали: ${row.contextIn}` : ''
				const parts = row.parts.map((p) => `    ${p}`).join('\n')

				return `${head}${context}\n  Я написал:\n${parts}`
			})

			return text(`Найдено ${rows.length}:\n\n${rendered.join('\n\n')}`)
		},
	)
}
