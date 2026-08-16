import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from './context.js'

/**
 * Prompts wrap the tools as slash commands.
 *
 * They also press harder than a tool result can: a prompt becomes part of the
 * conversation itself, so the instruction to obey the brief arrives before the
 * model starts composing rather than as data it may skim.
 */
export function registerPrompts(server: McpServer, _ctx: ToolContext) {
  server.registerPrompt(
    'as-me',
    {
      title: 'Написать как я',
      description: 'Сочинить текст голосом владельца архива.',
      argsSchema: {
        task: z.string().describe('Что нужно написать.'),
      },
    },
    ({ task }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Вызови write_as_me с этим заданием: ${task}\n\n` +
              'Дальше строго следуй полученному брифу: профилю, ограничениям ' +
              'и формату ответа. Затем прогони результат через check_as_me и, ' +
              'если оценка ниже 85, перепиши по замечаниям и проверь снова. ' +
              'Покажи только итоговый текст.',
          },
        },
      ],
    })
  )

  server.registerPrompt(
    'reply-as-me',
    {
      title: 'Ответить как я',
      description: 'Ответить на входящее сообщение голосом владельца архива.',
      argsSchema: {
        incoming: z.string().describe('Сообщение, на которое нужно ответить.'),
        hint: z.string().optional().describe('Что по смыслу ответить.'),
      },
    },
    ({ incoming, hint }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Вызови reply_as_me. Входящее сообщение: ${incoming}` +
              (hint ? `\nСмысл ответа: ${hint}` : '') +
              '\n\nДальше строго следуй полученному брифу. Затем прогони ответ ' +
              'через check_as_me и, если оценка ниже 85, перепиши по ' +
              'замечаниям. Покажи только итоговый ответ, готовый к отправке.',
          },
        },
      ],
    })
  )
}
