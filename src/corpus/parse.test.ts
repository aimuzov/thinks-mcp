import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  chatsOf,
  iterateChats,
  readDump,
  resolveOwnerId,
  streamChats,
  type Dump,
} from './parse.js'
import { makeDump } from '../testing/fixtures.js'

const dir = mkdtempSync(join(tmpdir(), 'thinks-parse-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

let files = 0
function write(dump: unknown, indent?: number): string {
  const path = join(dir, `dump-${files++}.json`)
  writeFileSync(path, JSON.stringify(dump, null, indent))
  return path
}

/** The fixture wrapped in what a real export carries around the chats. */
function realisticDump() {
  const dump = makeDump()
  const [petr, neighbours] = dump.chats.list
  return {
    about: 'Here is the data you requested. {"not": ["a", "chat"]}',
    personal_information: { user_id: 1, first_name: 'Ivan', bio: '\\"}]' },
    contacts: { about: 'x', list: [{ first_name: 'A', phone_number: '+1' }] },
    chats: {
      about: 'chats',
      list: [
        ...dump.chats.list,
        {
          name: null,
          type: 'private_group',
          id: 400,
          messages: [
            {
              id: 1,
              type: 'service',
              actor_id: 'user9',
              action: 'create_group',
            },
            {
              id: 2,
              type: 'message',
              date_unixtime: '1700000000',
              from: 'Эмодзи 😀 и "кавычки"',
              from_id: 'user3',
              text: ['Жирный ', { type: 'bold', text: 'текст' }],
              text_entities: [
                { type: 'plain', text: 'Жирный ' },
                { type: 'bold', text: 'текст\n\t  \\ "' },
                { type: 'plain', text: '' },
              ],
              photo: '(File not included.)',
              width: 1280,
              reactions: [{ type: 'emoji', count: 2, emoji: '👍' }],
            },
          ],
        },
      ],
    },
    left_chats: {
      about: 'left',
      list: [{ ...petr!, id: 500, name: 'Ушёл' }],
    },
    frequent_contacts: { list: [{ id: 1, name: neighbours!.name }] },
  }
}

type Chats = ReturnType<typeof chatsOf>

/** The owner lookup as it was before going single-pass. */
function legacyOwner(chats: Chats): string {
  for (const chat of chats) {
    if (chat.type !== 'saved_messages') continue
    for (const m of chat.messages ?? []) if (m.from_id) return m.from_id
  }
  const counts = new Map<string, number>()
  for (const chat of chats) {
    for (const m of chat.messages ?? []) {
      if (m.from_id) counts.set(m.from_id, (counts.get(m.from_id) ?? 0) + 1)
    }
  }
  let best = ''
  for (const [id, count] of counts) {
    if (count > (counts.get(best) ?? 0)) best = id
  }
  return best
}

/** What the whole-file `JSON.parse` used to give. */
function legacy(dump: object) {
  const chats = chatsOf(
    JSON.parse(JSON.stringify(dump)) as Parameters<typeof chatsOf>[0]
  )
  return {
    owner: legacyOwner(chats),
    chats: [...iterateChats(chats, ['Соседи'])],
  }
}

function streamed(path: string, chunkSize?: number) {
  const chats: Dump = { [Symbol.iterator]: () => streamChats(path, chunkSize) }
  return {
    owner: resolveOwnerId(chats),
    chats: [...iterateChats(chats, ['Соседи'])],
  }
}

describe('streaming parser', () => {
  it('matches a whole-file parse on the fixtures', () => {
    const dump = makeDump()
    const path = write(dump)
    const parsed = streamed(path)
    expect(parsed).toEqual(legacy(dump))
    expect(parsed.chats.length).toBeGreaterThan(0)
  })

  it('matches on a realistic export at any chunk size', () => {
    const dump = realisticDump()
    const expected = legacy(dump)
    for (const indent of [undefined, 1]) {
      const path = write(dump, indent)
      for (const chunk of [1, 2, 3, 7, 64, 1 << 20]) {
        expect(streamed(path, chunk)).toEqual(expected)
      }
    }
  })

  it('falls back to the busiest sender without Saved Messages', () => {
    const dump = makeDump()
    dump.chats.list = dump.chats.list.filter(c => c.type !== 'saved_messages')
    expect(resolveOwnerId(readDump(write(dump)))).toBe(legacy(dump).owner)
  })

  it('re-reads the file on every pass', () => {
    const dump = readDump(write(makeDump()))
    expect([...dump].length).toBe(3)
    expect([...dump].length).toBe(3)
  })

  it('reports where a truncated file breaks', () => {
    const path = join(dir, 'broken.json')
    writeFileSync(path, JSON.stringify(makeDump()).slice(0, 500))
    expect(() => [...readDump(path)]).toThrow(SyntaxError)
  })
})
