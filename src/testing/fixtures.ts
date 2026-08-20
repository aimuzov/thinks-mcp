const OWNER = 'user1'
const FRIEND = 'user2'

interface FixtureMessage {
  id: number
  type: string
  date_unixtime: string
  from: string
  from_id: string
  text: string
  text_entities: { type: string; text: string }[]
  forwarded_from?: string
  via_bot?: string
  reply_to_message_id?: number
}

let nextId = 1

function msg(
  fromId: string,
  ts: number,
  entities: { type: string; text: string }[],
  extra: Partial<FixtureMessage> = {}
): FixtureMessage {
  return {
    id: nextId++,
    type: 'message',
    date_unixtime: String(ts),
    from: fromId === OWNER ? 'Ivan Petrov' : 'Sergey Volkov',
    from_id: fromId,
    text: entities.map(e => e.text).join(''),
    text_entities: entities,
    ...extra,
  }
}

const plain = (text: string) => [{ type: 'plain', text }]

/**
 * A miniature export exercising every rule the corpus pipeline has: bursts,
 * reply context, forwards, bot messages, pasted JSON, link spam and PII.
 * Timestamps are relative to an arbitrary epoch; only the gaps matter.
 */
export function makeDump() {
  nextId = 1
  const t = 1_700_000_000

  return {
    chats: {
      list: [
        {
          id: 100,
          name: 'Petr',
          type: 'personal_chat',
          messages: [
            msg(FRIEND, t, plain('Ты когда освободишься?')),
            // A burst: three messages inside the 90s window, one turn.
            msg(OWNER, t + 10, plain('Через час.')),
            msg(OWNER, t + 20, plain('Может раньше.')),
            msg(OWNER, t + 30, plain('Напишу как выйду.')),
            // Gap of an hour: a new turn, and the old context has expired.
            msg(OWNER, t + 4000, plain('Вышел.')),
            // Forward: someone else's voice, must not enter the corpus.
            msg(OWNER, t + 5000, plain('Длинный чужой текст про новости.'), {
              forwarded_from: 'Some Channel',
            }),
            // Via bot.
            msg(OWNER, t + 6000, plain('сгенерировано ботом'), {
              via_bot: '@somebot',
            }),
            // Pasted JSON.
            msg(OWNER, t + 7000, plain('{"update_id": 1, "message": {}}')),
            // Nothing but a link.
            msg(OWNER, t + 8000, [
              { type: 'link', text: 'https://example.com' },
            ]),
            // PII of every tagged kind, plus a surname in plain text.
            msg(OWNER, t + 9000, [
              { type: 'plain', text: 'Пиши на ' },
              { type: 'email', text: 'me@example.com' },
              { type: 'plain', text: ' или звони ' },
              { type: 'phone', text: '+7 999 123-45-67' },
              { type: 'plain', text: ', Volkov в курсе' },
            ]),
            // text_link keeps its visible words, drops the href.
            msg(OWNER, t + 10000, [
              { type: 'plain', text: 'Смотри ' },
              { type: 'text_link', text: 'вот сюда' },
            ]),
            // An explicit quote: the owner answers the older of two incoming
            // messages, so the pair must come from reply_to, not from order.
            msg(FRIEND, t + 11000, plain('А что с доставкой?')),
            msg(FRIEND, t + 11500, plain('И ещё, ты не забыл про ключи?')),
            msg(OWNER, t + 11600, plain('Да, там же.'), {
              reply_to_message_id: 12,
            }),
          ],
        },
        {
          id: 200,
          name: 'Соседи',
          type: 'private_supergroup',
          messages: [
            msg(FRIEND, t + 100, plain('Кто вызывал сантехника?')),
            msg(OWNER, t + 130, plain('Не я.')),
            msg(
              OWNER,
              t + 20000,
              plain(
                'Расскажу подробно, потому что вопрос повторяется. ' +
                  'Сантехника вызывает управляющая компания по заявке через ' +
                  'приложение, заявка попадает диспетчеру, дальше он сам ' +
                  'распределяет по мастерам. Ждать обычно приходится сутки, ' +
                  'иногда двое, если авария не признана срочной. Быстрее ' +
                  'выходит позвонить напрямую и уточнить статус заявки.'
              )
            ),
          ],
        },
        {
          id: 300,
          name: 'Saved Messages',
          type: 'saved_messages',
          messages: [msg(OWNER, t + 50, plain('Напоминание себе.'))],
        },
      ],
    },
  }
}

export const OWNER_ID = OWNER
export const FRIEND_ID = FRIEND
