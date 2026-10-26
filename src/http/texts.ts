import { requestLocale } from '@aimuzov/infra-mcp-kit/i18n'

// Тексты ответов кабинета, которые человек видит на странице: на её языке.
const TEXTS = {
	ru: {
		loginFailed: 'Telegram не подтвердил вход',
		loginAgain: 'Попробуй войти ещё раз.',
		tooLarge: 'Файл больше допустимого',
		busy: 'Предыдущая загрузка или сборка ещё не закончилась',
		jsonOnly: 'Обнови страницу кабинета и сохрани ещё раз',
		requestTooLarge: 'Слишком большой запрос',
		badJson: 'Не удалось прочитать настройки',
		deleteBusy: 'Дождись конца сборки, потом удаляй аккаунт',
		aborted: 'Загрузка оборвалась',
		uploadFailed: 'Не удалось сохранить файл, попробуй позже',
	},
	en: {
		loginFailed: 'Telegram did not confirm the sign-in',
		loginAgain: 'Try to sign in again.',
		tooLarge: 'The file is larger than allowed',
		busy: 'The previous upload or build has not finished yet',
		jsonOnly: 'Reload the account page and save again',
		requestTooLarge: 'The request is too large',
		badJson: 'Could not read the settings',
		deleteBusy: 'Wait for the build to finish, then delete the account',
		aborted: 'The upload was cut off',
		uploadFailed: 'Could not save the file, try again later',
	},
} as const

export type TextKey = keyof (typeof TEXTS)['ru']

/** Текст ответа на языке страницы, с которой пришёл запрос. */
export function say(request: Request, key: TextKey): string {
	return TEXTS[requestLocale(request)][key]
}
