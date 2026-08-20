import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { writeFileSync } from 'node:fs'
import type { Config } from '../config.js'
import { buildCorpus } from '../corpus/build.js'
import { makeDump } from '../testing/fixtures.js'
import { createServer } from './server.js'

/** Build a real corpus from the fixture dump, then serve it. */
function seededConfig(): Config {
  const dir = mkdtempSync(join(tmpdir(), 'thinks-mcp-'))
  const dumpPath = join(dir, 'dump.json')
  writeFileSync(dumpPath, JSON.stringify(makeDump()), 'utf8')

  const cfg: Config = {
    dumpPath,
    dataDir: dir,
    dbPath: join(dir, 'style.db'),
    ownerId: '',
    chatStopList: [],
    burstWindowSeconds: 90,
    longformMinChars: 300,
    holdoutSize: 0,
  }
  buildCorpus(cfg)
  return cfg
}

async function connect(cfg: Config) {
  const server = createServer(cfg)
  const client = new Client({ name: 'test', version: '0.0.0' })
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverT), client.connect(clientT)])
  return client
}

const textOf = (result: unknown): string =>
  ((result as { content: { type: string; text: string }[] }).content ?? [])
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n')

let cfg: Config

beforeEach(() => {
  cfg = seededConfig()
})

describe('MCP server (end to end)', () => {
  it('registers every tool', async () => {
    const client = await connect(cfg)
    const { tools } = await client.listTools()
    expect(tools.map(t => t.name).sort()).toEqual([
      'check_as_me',
      'find_my_messages',
      'rephrase_as_me',
      'reply_as_me',
      'write_as_me',
    ])
  })

  it('write_as_me returns a brief with profile, examples and contract', async () => {
    const client = await connect(cfg)
    const text = textOf(
      await client.callTool({
        name: 'write_as_me',
        arguments: { brief: 'напиши, что задержусь' },
      })
    )

    expect(text).toContain('# ЗАДАЧА')
    expect(text).toContain('# ПРИМЕРЫ ИЗ АРХИВА')
    expect(text).toContain('# ОГРАНИЧЕНИЯ')
    expect(text).toContain('# ФОРМАТ ОТВЕТА')
    // The brief must carry real messages, not just a description of them.
    expect(text).toMatch(/Через час\.|Вышел\./)
  })

  it('reply_as_me shows what was said before the answer', async () => {
    const client = await connect(cfg)
    const text = textOf(
      await client.callTool({
        name: 'reply_as_me',
        arguments: { incoming: 'Ты когда освободишься?' },
      })
    )

    expect(text).toContain('Ты когда освободишься?')
    expect(text).toContain('Через час.')
    // The fixture pair is inferred from message order, not quoted, and the
    // brief has to say so rather than presenting it as a real answer.
    expect(text).toContain('Перед этим написали:')
  })

  it('check_as_me scores text and returns structured findings', async () => {
    const client = await connect(cfg)
    const result = await client.callTool({
      name: 'check_as_me',
      arguments: { text: 'Однако следует отметить:\n- первое\n- второе' },
    })

    const report = (
      result as { structuredContent: { score: number; findings: unknown[] } }
    ).structuredContent
    expect(report.score).toBeLessThan(80)
    expect(report.findings.length).toBeGreaterThan(0)
    expect(textOf(result)).toContain('Оценка:')
  })

  it('find_my_messages searches the archive', async () => {
    const client = await connect(cfg)
    const text = textOf(
      await client.callTool({
        name: 'find_my_messages',
        arguments: { query: 'сантехник' },
      })
    )
    expect(text).toContain('Сантехника вызывает')
  })

  it('serves the style profile as a resource', async () => {
    const client = await connect(cfg)
    const { contents } = await client.readResource({ uri: 'style://profile' })
    expect(String(contents[0].text)).toContain('Как я пишу')
  })

  it('exposes the prompts', async () => {
    const client = await connect(cfg)
    const { prompts } = await client.listPrompts()
    expect(prompts.map(p => p.name).sort()).toEqual([
      'as-me',
      'comment-as-me',
      'reply-as-me',
    ])
  })

  it('accepts every register the corpus can hold', async () => {
    // The zod enum and the Register type drifted apart once: the type gained
    // code/jsdoc while the schema still rejected them at the protocol edge.
    const client = await connect(cfg)
    for (const register of ['dm', 'group', 'longform', 'code', 'jsdoc']) {
      const result = await client.callTool({
        name: 'find_my_messages',
        arguments: { query: 'что угодно', register, limit: 2 },
      })
      expect(
        textOf(result),
        `register=${register} отвергнут схемой`
      ).not.toContain('Input validation error')
    }
  })

  it('starts without a corpus and explains how to build one', async () => {
    // The server lives in a global MCP config; a machine with no archive must
    // still get a working server rather than a dead entry in the list.
    const client = await connect({
      ...cfg,
      dbPath: join(cfg.dataDir, 'missing.db'),
    })

    const { tools } = await client.listTools()
    expect(tools).toHaveLength(5)

    const result = await client.callTool({
      name: 'write_as_me',
      arguments: { brief: 'что угодно' },
    })
    expect((result as { isError?: boolean }).isError).toBe(true)
    expect(textOf(result)).toContain('thinks-mcp build')

    const { contents } = await client.readResource({ uri: 'style://profile' })
    expect(String(contents[0].text)).toContain('thinks-mcp build')
  })

  it('picks up a corpus built after startup, without a restart', async () => {
    const dbPath = join(cfg.dataDir, 'later.db')
    const client = await connect({ ...cfg, dbPath })

    expect(
      (
        (await client.callTool({
          name: 'find_my_messages',
          arguments: { query: 'сантехник' },
        })) as { isError?: boolean }
      ).isError
    ).toBe(true)

    buildCorpus({ ...cfg, dbPath })

    const after = await client.callTool({
      name: 'find_my_messages',
      arguments: { query: 'сантехник' },
    })
    expect((after as { isError?: boolean }).isError).toBeFalsy()
    expect(textOf(after)).toContain('Сантехника вызывает')
  })
})
