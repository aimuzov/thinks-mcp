/**
 * Which situation a turn belongs to. Tools take this as a facet.
 *
 * The chat registers and the code registers come from different corpora and
 * are measured differently: length, punctuation and emoji describe a chat
 * message, while a comment is judged on line width, markers and whether it
 * explains a reason. Keeping them in one enum is what lets a single search and
 * a single brief serve both.
 */
export type Register = 'dm' | 'group' | 'longform' | 'code' | 'jsdoc'

/** The registers built from source repositories rather than from chats. */
export const CODE_REGISTERS: Register[] = ['code', 'jsdoc']

export const isCodeRegister = (r: Register): boolean =>
  r === 'code' || r === 'jsdoc'

/**
 * A slice of message text tagged with its kind. Telegram guarantees the
 * concatenation of every entity's `text` equals the full message text — which
 * holds for every message of a real export — so sanitizing at the entity level
 * is exact and needs no regex over raw text.
 */
export interface TextEntity {
  type: string
  text: string
}

/** One message, normalized out of the export's many optional shapes. */
export interface ParsedMessage {
  id: number
  /** Unix seconds. */
  ts: number
  /** Telegram user id, e.g. `user1340580`. Empty for channel posts. */
  fromId: string
  /** Display name of the sender, used to build pseudonyms. */
  from: string
  entities: TextEntity[]
  /** Concatenated entity text. */
  text: string
  /** Forwarded messages carry someone else's voice and are dropped. */
  isForwarded: boolean
  isViaBot: boolean
  replyToId: number | null
}

export interface ParsedChat {
  id: number
  name: string
  /** Raw export type: personal_chat | private_group | private_supergroup | ... */
  type: string
  /** Stable pseudonym used instead of the real chat name. */
  key: string
  /** Base register for turns in this chat; longform is assigned per turn. */
  register: Exclude<Register, 'longform'>
  messages: ParsedMessage[]
}

/** A run of consecutive owner messages, the unit the corpus is built from. */
export interface Turn {
  /** Chat pseudonym for chat turns, repository name for code ones. */
  chatKey: string
  /**
   * Where it was said. `longform` is not a place, so it is a separate flag: a
   * long turn is still a dm or a group turn and must stay findable as one.
   */
  register: Exclude<Register, 'longform'>
  longform: boolean
  /** Language of the text; only meaningful for code, where both are used. */
  lang?: 'ru' | 'en'
  /** Unix seconds of the first message in the run. */
  ts: number
  year: number
  /** Individual messages of the burst, in order. */
  parts: string[]
  /** parts joined by newline. */
  text: string
  chars: number
  /** The interlocutor message this turn answers, if any. */
  contextIn: string | null
}
