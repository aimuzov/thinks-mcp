import { pt } from '@aimuzov/infra-mcp-kit/astro/lib/i18n.ts'

// Язык страницы, с которой зовут API: его поставил layout кита на `<html lang>`.
const lang = () => document.documentElement.lang

/** Ответ JSON-API кабинета: тело или текст ошибки, который можно показать человеку. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

/** Текст ошибки из `{ error: { message } }` кита, а если тела нет -- по статусу. */
export async function readError(res: Response): Promise<string> {
	const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null

	return body?.error?.message ?? pt(lang(), 'thinks.api.status', { status: res.status })
}

/** POST в API кабинета. Origin браузер ставит сам: по нему сервер отличает свои страницы. */
export async function post<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
	const res = await fetch(path, {
		method: 'POST',
		headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
		body: body === undefined ? undefined : JSON.stringify(body),
	}).catch(() => null)

	if (!res) return { ok: false, status: 0, message: pt(lang(), 'thinks.api.offline') }

	if (!res.ok) return { ok: false, status: res.status, message: await readError(res) }

	return { ok: true, data: (await res.json()) as T }
}
