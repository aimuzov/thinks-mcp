import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ensureDataDir, type Config } from '../config.js'
import { CorpusRef, type ToolContext } from './context.js'
import { registerPrompts } from './prompts.js'
import { registerResources } from './resources.js'
import { registerCheckAsMe } from './tools/checkAsMe.js'
import { registerFindMyMessages } from './tools/findMyMessages.js'
import { registerReplyAsMe } from './tools/replyAsMe.js'
import { registerRephraseAsMe } from './tools/rephraseAsMe.js'
import { registerWriteAsMe } from './tools/writeAsMe.js'

const VERSION = '0.1.0'

/**
 * Build a fully-wired MCP server.
 *
 * Never throws for a missing corpus: the server is meant to live in a global
 * MCP config, and a machine that has not imported an archive yet should see a
 * working server that explains what to do, not a failed one.
 */
export function createServer(cfg: Config): McpServer {
  ensureDataDir(cfg)

  const ctx: ToolContext = { cfg, corpus: new CorpusRef(cfg) }
  const server = new McpServer({ name: 'aimuzov-thinks-mcp', version: VERSION })

  registerWriteAsMe(server, ctx)
  registerReplyAsMe(server, ctx)
  registerRephraseAsMe(server, ctx)
  registerCheckAsMe(server, ctx)
  registerFindMyMessages(server, ctx)
  registerResources(server, ctx)
  registerPrompts(server, ctx)

  return server
}

/** Run the MCP server over stdio. */
export async function serve(cfg: Config): Promise<void> {
  const server = createServer(cfg)
  await server.connect(new StdioServerTransport())
  console.error('aimuzov-thinks-mcp running on stdio')
}
