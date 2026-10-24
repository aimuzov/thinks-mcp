import type { BuildStatus } from './builds.ts'
import type { HttpConfig } from './config.ts'
import type { UserSettings } from './users.ts'

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

const STYLE = `
  :root { color-scheme: light dark; --fg: #1c1c1e; --bg: #fff; --muted: #6e6e73; --line: #d2d2d7; --accent: #2a7ae2; }
  @media (prefers-color-scheme: dark) { :root { --fg: #f2f2f7; --bg: #1c1c1e; --muted: #98989d; --line: #3a3a3c; --accent: #5ea0ff; } }
  body { font: 16px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); max-width: 640px; margin: 40px auto; padding: 0 16px; }
  h1 { font-size: 24px; } h2 { font-size: 18px; margin-top: 32px; }
  p, li { color: var(--fg); } .muted { color: var(--muted); font-size: 14px; }
  code { background: color-mix(in srgb, var(--line) 40%, transparent); padding: 1px 4px; border-radius: 4px; }
  input[type=text], input[type=number] { width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); }
  button { padding: 8px 16px; border-radius: 6px; border: 1px solid var(--line); background: var(--accent); color: #fff; cursor: pointer; }
  button.plain { background: transparent; color: var(--fg); } button.danger { background: #d70015; border-color: #d70015; }
  section { border-top: 1px solid var(--line); }
`

function page(title: string, body: string): string {
	return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body>${body}</body></html>`
}

/**
 * The Telegram button. In dev mode there is no bot bound to localhost, so a
 * plain link goes to the same callback and the server logs in the dev user.
 */
function loginButton(cfg: HttpConfig, authUrl: string): string {
	if (cfg.devUserId) {
		const url = new URL(authUrl)
		url.searchParams.set('dev', '1')
		return `<p><a href="${escapeHtml(url.href)}"><button type="button">Войти как ${escapeHtml(cfg.devUserId)} (dev)</button></a></p>`
	}
	return `<script async src="https://telegram.org/js/telegram-widget.js?22"
    data-telegram-login="${escapeHtml(cfg.telegramBotName)}" data-size="large"
    data-auth-url="${escapeHtml(authUrl)}"></script>`
}

export function loginPage(
	cfg: HttpConfig,
	opts: { authUrl: string; clientName: string; redirectHost: string },
): string {
	const client = opts.clientName
		? `${escapeHtml(opts.clientName)} (${escapeHtml(opts.redirectHost)})`
		: escapeHtml(opts.redirectHost)
	return page(
		'Вход в thinks',
		`<h1>Подключение thinks</h1>
<p>${client} просит доступ к твоему корпусу: стиль-профилю и сообщениям, по которым он пишет твоим голосом.</p>
<p>Войди через Telegram, чтобы разрешить.</p>
${loginButton(cfg, opts.authUrl)}
<p class="muted">Если ты не начинал подключение сам, просто закрой страницу.</p>`,
	)
}

export function landingPage(cfg: HttpConfig): string {
	const mcp = new URL('/mcp', cfg.publicUrl).href
	return page(
		'thinks',
		`<h1>thinks</h1>
<p>MCP-коннектор, который пишет, отвечает и переформулирует твоим голосом -- по твоей же переписке в Telegram. Сам он ничего не генерирует: отдаёт модели стиль-профиль и твои настоящие сообщения под запрос.</p>
<p><a href="/account">Личный кабинет</a> -- загрузить выгрузку, настроить, удалить данные.</p>
<p>Адрес коннектора: <code>${escapeHtml(mcp)}</code></p>`,
	)
}

export function accountLoginPage(cfg: HttpConfig): string {
	const authUrl = new URL('/account/login', cfg.publicUrl).href
	return page(
		'Кабинет thinks',
		`<h1>Кабинет thinks</h1>
<p>Войди через Telegram. Корпус привязан к твоему аккаунту, и загрузить можно только свою выгрузку.</p>
${loginButton(cfg, authUrl)}`,
	)
}

const STATE_TEXT: Record<BuildStatus['state'], string> = {
	queued: 'в очереди на сборку',
	building: 'собирается',
	ready: 'собран',
	failed: 'сборка не удалась',
}

export function accountPage(
	cfg: HttpConfig,
	opts: {
		name: string
		hasCorpus: boolean
		status: BuildStatus | null
		settings: UserSettings
	},
): string {
	const mcp = new URL('/mcp', cfg.publicUrl).href
	const { status, settings } = opts
	const busy = status?.state === 'queued' || status?.state === 'building'

	const corpusLine = busy
		? `Корпус ${STATE_TEXT[status!.state]}. Страница обновится сама.`
		: opts.hasCorpus
			? 'Корпус собран, коннектор готов к работе.'
			: 'Корпуса пока нет: загрузи выгрузку ниже.'
	const failure =
		status?.state === 'failed'
			? `<p><strong>Последняя сборка не удалась:</strong> ${escapeHtml(status.message)}</p>`
			: ''
	const maxMb = Math.round(cfg.maxUploadBytes / 1024 / 1024)

	return page(
		'Кабинет thinks',
		`<h1>Привет, ${escapeHtml(opts.name)}</h1>
<p>${corpusLine}</p>${failure}
${busy ? '<script>setTimeout(() => location.reload(), 5000)</script>' : ''}

<section><h2>Выгрузка из Telegram</h2>
<p>Telegram Desktop: Settings > Advanced > Export Telegram data. Формат JSON, все медиа выключить -- нужен только текст. Загрузи получившийся <code>result.json</code> (до ${maxMb} МБ).</p>
<p><input type="file" id="dump" accept=".json,application/json"> <button id="upload" type="button" ${busy ? 'disabled' : ''}>Загрузить и собрать</button></p>
<p id="progress" class="muted"></p>
<p class="muted">Выгрузка удаляется сразу после сборки. Новая сборка заменяет старый корпус, только если прошла успешно.</p>
</section>

<section><h2>Подключение</h2>
<p>Адрес коннектора: <code>${escapeHtml(mcp)}</code></p>
<ul>
<li>claude.ai и Claude Desktop: Settings > Connectors > Add custom connector, вставить адрес.</li>
<li>Claude Code: <code>claude mcp add --transport http thinks ${escapeHtml(mcp)}</code>, затем <code>/mcp</code> для входа.</li>
</ul>
</section>

<section><h2>Настройки</h2>
<form method="post" action="/account/settings">
<p><label>Знаки, которые ты не набираешь, и замена<br>
<input type="text" name="neverMarks" value="${escapeHtml(settings.neverMarks)}" placeholder='—:--,…:...,«:",»:"'></label></p>
<p><label>Чаты, которые не попадут в корпус (через запятую)<br>
<input type="text" name="chatStopList" value="${escapeHtml(settings.chatStopList)}"></label></p>
<p><label>Сколько последних лет считать "как я пишу сейчас"<br>
<input type="number" name="recentYears" min="1" max="20" value="${settings.recentYears}"></label></p>
<p><label><input type="checkbox" name="voice" value="1" ${settings.voice ? 'checked' : ''}> Claude говорит со мной моим голосом</label></p>
<p><button type="submit">Сохранить</button></p>
<p class="muted">Знаки применяются сразу, голос -- с нового чата. Список чатов и годы -- после следующей сборки.</p>
<p class="muted">Если в новом чате Claude всё равно пишет по-своему, значит клиент не передаёт ему настройки коннектора. Тогда выбери в чате промпт "Говори как я" из меню коннектора.</p>
</form>
</section>

<section><h2>Данные</h2>
<p class="muted">На сервере хранится корпус: твои сообщения, очищенные от телефонов, почты, карт, ссылок и фамилий, реплики собеседников, на которые ты отвечал, индексы поиска и стиль-профиль. Никому, кроме подключённых тобой клиентов, они не отдаются.</p>
<form method="post" action="/account/delete" onsubmit="return confirm('Удалить корпус, настройки и всё остальное без возврата?')">
<p><button class="danger" type="submit">Удалить все мои данные</button></p>
</form>
<form method="post" action="/account/logout"><p><button class="plain" type="submit">Выйти</button></p></form>
</section>

<script>
document.getElementById('upload').onclick = () => {
  const file = document.getElementById('dump').files[0]
  const progress = document.getElementById('progress')
  if (!file) { progress.textContent = 'Выбери файл'; return }
  const xhr = new XMLHttpRequest()
  xhr.open('PUT', '/account/upload')
  xhr.setRequestHeader('content-type', 'application/octet-stream')
  xhr.upload.onprogress = e => { progress.textContent = 'Загружено ' + Math.round(e.loaded / e.total * 100) + '%' }
  xhr.onload = () => { if (xhr.status < 300) location.reload(); else progress.textContent = xhr.responseText || 'Ошибка ' + xhr.status }
  xhr.onerror = () => { progress.textContent = 'Соединение оборвалось' }
  xhr.send(file)
}
</script>`,
	)
}
