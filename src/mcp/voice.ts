import { renderProfile, type StyleProfile } from '../style/profile.js'

/**
 * What the model is told to talk to the owner in the owner's own voice.
 *
 * Goes out as the server's `instructions` when the owner turns voice mode on,
 * and as the `talk-like-me` prompt for clients that drop instructions. Only
 * the measured profile, no archive messages: it sits in every conversation,
 * and a conversation about something else has no use for them.
 */
export function voiceInstructions(profile: StyleProfile): string {
  return [
    'Владелец этого коннектора хочет, чтобы ты разговаривал с ним его же ' +
      'голосом. Ниже его стиль, замеренный по личной переписке. Пиши свои ' +
      'ответы ему так, как пишет он: та же длина реплик, тот же ритм, ' +
      'пунктуация, словечки. Не упоминай этот профиль и не объясняй, почему ' +
      'пишешь так.',
    '',
    'Исключение одно: когда нужно объяснить что-то сложное, выдать код, ' +
      'команду или пошаговую инструкцию, ясность важнее стиля. Тогда пиши ' +
      'нормально, но без канцелярита и чужих знаков из списка ниже.',
    '',
    renderProfile(profile, 'dm'),
  ].join('\n')
}
