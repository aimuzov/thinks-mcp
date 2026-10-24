import { html, telegramButton, ui, type Service } from '@aimuzov/infra-mcp-kit/http'

import type { BuildStatus } from './builds.ts'
import type { UserSettings } from './users.ts'

export const SERVICE: Service = { name: 'thinks', repo: 'https://github.com/aimuzov/thinks-mcp' }

/** What a client gets once the owner logs in, shown on the consent page. */
export const GRANTS = ['Читать стиль-профиль', 'Искать по твоим сообщениям', 'Проверять тексты на похожесть']

export const TOOLS = ['write_as_me', 'reply_as_me', 'rephrase_as_me', 'check_as_me', 'find_my_messages']

export const LANDING = {
	tagline: 'Пишет, отвечает и переформулирует твоим голосом',
	lead: 'MCP-коннектор, который учится по твоей переписке в Telegram. Сам он ничего не генерирует: отдаёт модели стиль-профиль и твои настоящие сообщения под запрос.',
	tools: TOOLS,
	aside: html`<a href="/account">Личный кабинет</a> — загрузить выгрузку, настроить, удалить данные.`,
}

export const ACCOUNT_SCRIPT = '/account.js'

export function accountLoginPage(authUrl: URL, telegram: { botName: string; devUserId?: string }): string {
	return ui.document({
		service: SERVICE,
		title: `Кабинет ${SERVICE.name}`,
		screen: 'consent',
		main: html`<section class="panel auth">
			<h1>Кабинет ${SERVICE.name}</h1>
			<p class="muted">
				Войди через Telegram. Корпус привязан к&nbsp;твоему аккаунту, и&nbsp;загрузить можно только свою
				выгрузку.
			</p>
			${telegramButton(authUrl, telegram)}
		</section>`,
	})
}

const STATE_TEXT: Record<BuildStatus['state'], string> = {
	queued: 'Корпус в очереди на сборку',
	building: 'Корпус собирается',
	ready: 'Корпус собран',
	failed: 'Сборка не удалась',
}

export type AccountView = {
	name: string
	mcpUrl: string
	hasCorpus: boolean
	status: BuildStatus | null
	settings: UserSettings
	maxUploadBytes: number
}

function corpusStatus({ hasCorpus, status }: AccountView) {
	if (status?.state === 'queued' || status?.state === 'building') {
		return ui.status({ tone: 'busy', title: STATE_TEXT[status.state], detail: 'Страница обновится сама' })
	}

	if (status?.state === 'failed') {
		return ui.status({ tone: 'error', title: STATE_TEXT.failed, detail: status.message })
	}

	return hasCorpus
		? ui.status({ tone: 'ok', title: 'Корпус собран', detail: 'Коннектор готов к работе' })
		: ui.status({ tone: 'error', title: 'Корпуса пока нет', detail: 'Загрузи выгрузку ниже' })
}

export function accountPage(view: AccountView): string {
	const { status, settings, mcpUrl } = view
	const busy = status?.state === 'queued' || status?.state === 'building'
	const maxMb = Math.round(view.maxUploadBytes / 1024 / 1024)

	return ui.accountPage({
		service: SERVICE,
		greeting: `Привет, ${view.name}`,
		scripts: [ACCOUNT_SCRIPT],
		sections: [
			html`<div ${busy ? html`data-reload="5000"` : ''}>${corpusStatus(view)}</div>`,
			ui.panel({
				title: 'Выгрузка из Telegram',
				body: html`<p class="muted">
						Telegram Desktop: Settings → Advanced → Export Telegram data. Формат JSON, все медиа выключить:
						нужен только текст. Загрузи получившийся <code>result.json</code> (до&nbsp;${maxMb}&nbsp;МБ).
					</p>
					<div class="row">
						<input type="file" id="dump" accept=".json,application/json" />
						<button class="btn btn--primary" id="upload" type="button" ${busy ? html`disabled` : ''}>
							Загрузить и собрать
						</button>
					</div>
					<p id="progress" class="muted" aria-live="polite"></p>
					<p class="hint">
						Выгрузка удаляется сразу после сборки. Новая сборка заменяет старый корпус, только если прошла
						успешно.
					</p>`,
			}),
			ui.panel({
				title: 'Подключение',
				body: html`<div class="url">
						<code>${mcpUrl}</code
						><button class="btn btn--ghost" type="button" data-copy="${mcpUrl}">Скопировать</button>
					</div>
					<ol class="steps">
						<li>
							claude.ai и Claude Desktop: Settings → Connectors → Add custom connector, вставить адрес.
						</li>
						<li>
							Claude Code: <code>claude mcp add --transport http thinks ${mcpUrl}</code>, затем
							<code>/mcp</code> для входа.
						</li>
					</ol>`,
			}),
			ui.panel({
				title: 'Настройки',
				body: html`<form class="form" method="post" action="/account/settings">
					${ui.field({
						name: 'neverMarks',
						label: 'Знаки, которые ты не набираешь, и замена',
						value: settings.neverMarks,
						placeholder: '—:--,…:...,«:",»:"',
						required: false,
					})}
					${ui.field({
						name: 'chatStopList',
						label: 'Чаты, которые не попадут в корпус (через запятую)',
						value: settings.chatStopList,
						required: false,
					})}
					${ui.field({
						name: 'recentYears',
						label: 'Сколько последних лет считать «как я пишу сейчас»',
						type: 'number',
						value: String(settings.recentYears),
					})}
					<label class="check"
						><input type="checkbox" name="voice" value="1" ${settings.voice ? html`checked` : ''} /> Claude
						говорит со мной моим голосом</label
					>
					<button class="btn btn--primary" type="submit">Сохранить</button>
					<p class="hint">
						Знаки применяются сразу, голос — с&nbsp;нового чата. Список чатов и&nbsp;годы — после следующей
						сборки.
					</p>
					<p class="hint">
						Если в&nbsp;новом чате Claude всё равно пишет по-своему, значит клиент не передаёт ему настройки
						коннектора. Тогда выбери в&nbsp;чате промпт «Говори как я» из&nbsp;меню коннектора.
					</p>
				</form>`,
			}),
			ui.panel({
				title: 'Данные',
				tone: 'danger',
				body: html`<p class="muted">
						На сервере хранится корпус: твои сообщения, очищенные от&nbsp;телефонов, почты, карт, ссылок
						и&nbsp;фамилий, реплики собеседников, на&nbsp;которые ты отвечал, индексы поиска
						и&nbsp;стиль-профиль. Никому, кроме подключённых тобой клиентов, они не&nbsp;отдаются.
					</p>
					<div class="row">
						<form
							method="post"
							action="/account/delete"
							data-confirm="Удалить корпус, настройки и всё остальное без возврата?"
						>
							<button class="btn btn--danger" type="submit">Удалить все мои данные</button>
						</form>
						<form method="post" action="/account/logout">
							<button class="btn btn--ghost" type="submit">Выйти</button>
						</form>
					</div>`,
			}),
		],
	})
}
