import { createHash } from 'node:crypto'

import { JsonScanner } from './scanner.ts'
import type { ParsedChat, ParsedMessage, TextEntity } from './types.ts'

/** Raw shapes we care about in a Telegram JSON export. */
type RawMessage = {
	id?: number
	type?: string
	date_unixtime?: string
	from?: string
	from_id?: string
	text?: unknown
	text_entities?: { type?: string; text?: string }[]
	forwarded_from?: string
	saved_from?: string
	via_bot?: string
	reply_to_message_id?: number
}

type RawChat = {
	id?: number
	name?: string | null
	type?: string
	messages?: RawMessage[]
}

type RawDump = {
	chats?: { list?: RawChat[] }
	left_chats?: { list?: RawChat[] }
}

/** The export's chats, `chats.list` then `left_chats.list`. Re-iterable. */
export type Dump = Iterable<RawChat>

/** Chats of an export already in memory, e.g. a test fixture. */
export function chatsOf(dump: RawDump): RawChat[] {
	return [...(dump.chats?.list ?? []), ...(dump.left_chats?.list ?? [])]
}

/**
 * Open the export for streaming. Each pass reads the file anew and holds one
 * chat at a time, trimmed to the fields below: parsing the 411 MB file whole
 * took ~2.3 GB RSS, which a small VPS does not have.
 */
export function readDump(dumpPath: string): Dump {
	return { [Symbol.iterator]: () => streamChats(dumpPath) }
}

/**
 * Chats in file order. Telegram Desktop writes `chats` before `left_chats`,
 * which is the order `chatsOf` gives too.
 */
export function* streamChats(dumpPath: string, chunkSize?: number): Generator<RawChat> {
	const s = new JsonScanner(dumpPath, chunkSize)

	try {
		for (const section of s.entries()) {
			if (section !== 'chats' && section !== 'left_chats') {
				s.skip()
				continue
			}

			for (const key of s.entries()) {
				if (key !== 'list') {
					s.skip()
					continue
				}

				for (const _ of s.items()) yield readChat(s)
			}
		}
	} finally {
		s.close()
	}
}

function readChat(s: JsonScanner): RawChat {
	const chat: RawChat = {}

	for (const key of s.entries()) {
		if (key === 'id') chat.id = s.value() as number
		else if (key === 'name') chat.name = s.value() as string | null
		else if (key === 'type') chat.type = s.value() as string
		else if (key === 'messages') {
			chat.messages = []

			for (const _ of s.items()) {
				chat.messages.push(trimMessage(s.value() as RawMessage))
			}
		} else s.skip()
	}

	return chat
}

/** Keep only what `iterateChats` and `resolveOwnerId` read. */
function trimMessage(m: RawMessage): RawMessage {
	return {
		id: m.id,
		type: m.type,
		date_unixtime: m.date_unixtime,
		from: m.from,
		from_id: m.from_id,
		text_entities: m.text_entities?.map((e) => ({
			type: e?.type,
			text: e?.text,
		})),
		forwarded_from: m.forwarded_from,
		saved_from: m.saved_from,
		via_bot: m.via_bot,
		reply_to_message_id: m.reply_to_message_id,
	}
}

/**
 * Figure out whose export this is. Saved Messages only ever contains the owner,
 * which is the strongest signal; otherwise fall back to the most prolific
 * sender, who in a personal archive is the owner by a wide margin.
 *
 * One pass: the counts are gathered on the way to Saved Messages, so a dump
 * without it is not read twice.
 */
export function resolveOwnerId(chats: Dump): string {
	const counts = new Map<string, number>()

	for (const chat of chats) {
		if (chat.type === 'saved_messages') {
			const own = chat.messages?.find((m) => m.from_id)

			if (own?.from_id) return own.from_id
		}

		for (const m of chat.messages ?? []) {
			if (!m.from_id) continue

			counts.set(m.from_id, (counts.get(m.from_id) ?? 0) + 1)
		}
	}

	let best = ''
	let bestCount = 0

	for (const [id, count] of counts) {
		if (count > bestCount) {
			best = id
			bestCount = count
		}
	}

	if (!best) {
		throw new Error(
			'Не удалось определить владельца выгрузки: ни у одного сообщения нет ' + 'from_id. Задай THINKS_OWNER_ID.',
		)
	}

	return best
}

/**
 * Chats and people are referred to by a short hash instead of their real name,
 * so the index never carries who the owner talks to. Stable across rebuilds.
 */
export function pseudonym(prefix: string, seed: string): string {
	const h = createHash('sha256').update(seed).digest('hex').slice(0, 6)

	return `${prefix}-${h}`
}

function entitiesOf(raw: RawMessage): TextEntity[] {
	const out: TextEntity[] = []

	for (const e of raw.text_entities ?? []) {
		const text = e?.text ?? ''

		if (text) out.push({ type: e?.type ?? 'plain', text })
	}

	return out
}

function registerOf(chatType: string): 'dm' | 'group' {
	return chatType === 'personal_chat' || chatType === 'saved_messages' ? 'dm' : 'group'
}

/**
 * Walk the export chat by chat. Yields every message, the owner's and the
 * interlocutors' alike: the latter are needed both as reply context and as the
 * background corpus the lexicon is scored against.
 */
export function* iterateChats(chats: Dump, stopList: string[] = []): Generator<ParsedChat> {
	const blocked = new Set(stopList.map((s) => s.toLowerCase()))

	for (const chat of chats) {
		const name = chat.name ?? ''

		if (blocked.has(name.toLowerCase())) continue

		const type = chat.type ?? 'unknown'
		const messages: ParsedMessage[] = []

		for (const raw of chat.messages ?? []) {
			if (raw.type !== 'message') continue

			const entities = entitiesOf(raw)

			messages.push({
				id: raw.id ?? 0,
				ts: Number.parseInt(raw.date_unixtime ?? '0', 10) || 0,
				fromId: raw.from_id ?? '',
				from: raw.from ?? '',
				entities,
				text: entities.map((e) => e.text).join(''),
				isForwarded: Boolean(raw.forwarded_from || raw.saved_from),
				isViaBot: Boolean(raw.via_bot),
				replyToId: raw.reply_to_message_id ?? null,
			})
		}

		yield {
			id: chat.id ?? 0,
			name,
			type,
			key: pseudonym('chat', `${chat.id ?? 0}:${name}`),
			register: registerOf(type),
			messages,
		}
	}
}
