import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Register } from '../corpus/types.js'
import { renderProfile, REGISTERS } from '../style/profile.js'
import { CORPUS_MISSING, type ToolContext } from './context.js'

/**
 * The profile as a readable document. Worth exposing on its own: it is the one
 * artefact a person can look at and say "yes, that is how I write" — or spot
 * that the corpus was built wrong.
 */
export function registerResources(server: McpServer, ctx: ToolContext) {
  const render = (register: Register) => {
    const corpus = ctx.corpus.get()
    return corpus
      ? renderProfile(corpus.profile, register, { full: true })
      : CORPUS_MISSING
  }

  server.registerResource(
    'style-profile',
    'style://profile',
    {
      title: 'Стиль-профиль (личная переписка)',
      description:
        'Как пишет владелец архива: длины, ритм, пунктуация, эмодзи, ' +
        'словечки и то, чего он не делает. Всё замерено по выгрузке.',
      mimeType: 'text/markdown',
    },
    async uri => ({
      contents: [
        { uri: uri.href, mimeType: 'text/markdown', text: render('dm') },
      ],
    })
  )

  server.registerResource(
    'style-profile-register',
    new ResourceTemplate('style://profile/{register}', {
      list: async () => ({
        resources: REGISTERS.map(register => ({
          uri: `style://profile/${register}`,
          name: `style-profile-${register}`,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    {
      title: 'Стиль-профиль по регистру',
      description:
        'dm — личка, group — групповой чат, longform — длинный текст, ' +
        'code — инлайн-комментарий, jsdoc — докблок.',
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const raw = String(variables.register)
      const register = (REGISTERS as string[]).includes(raw)
        ? (raw as Register)
        : 'dm'
      return {
        contents: [
          { uri: uri.href, mimeType: 'text/markdown', text: render(register) },
        ],
      }
    }
  )
}
