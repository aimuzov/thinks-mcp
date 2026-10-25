import { McpServer, readVersion } from '@aimuzov/infra-mcp-kit'

import type { Config } from '#thinks/config'

import { CorpusRef, type ToolContext } from './context.ts'
import { registerPrompts } from './prompts.ts'
import { registerResources } from './resources.ts'
import { registerCheckAsMe } from './tools/check-as-me.ts'
import { registerFindMyMessages } from './tools/find-my-messages.ts'
import { registerRephraseAsMe } from './tools/rephrase-as-me.ts'
import { registerReplyAsMe } from './tools/reply-as-me.ts'
import { registerWriteAsMe } from './tools/write-as-me.ts'
import { voiceInstructions } from './voice.ts'

const VERSION = readVersion(import.meta.url)

/**
 * Build a fully-wired MCP server.
 *
 * Never throws for a missing corpus: the server is meant to live in a global
 * MCP config, and a machine that has not imported an archive yet should see a
 * working server that explains what to do, not a failed one.
 *
 * Creates nothing on disk: in the hosted mode a token of a deleted account
 * would bring its directory back.
 */
export function createServer(cfg: Config, corpus: CorpusRef = new CorpusRef(cfg)): McpServer {
	const ctx: ToolContext = { cfg, corpus }
	// Instructions are read once, when the client connects: a corpus built or a
	// switch flipped later takes effect in the next conversation.
	const profile = cfg.voice ? corpus.get()?.profile : undefined
	const server = new McpServer(
		{ name: 'thinks-mcp', version: VERSION },
		profile ? { instructions: voiceInstructions(profile) } : {},
	)

	registerWriteAsMe(server, ctx)
	registerReplyAsMe(server, ctx)
	registerRephraseAsMe(server, ctx)
	registerCheckAsMe(server, ctx)
	registerFindMyMessages(server, ctx)
	registerResources(server, ctx)
	registerPrompts(server, ctx)

	return server
}
