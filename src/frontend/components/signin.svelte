<script lang="ts">
	import Alert from '@aimuzov/infra-site-kit/ui/alert.svelte'
	import Card from '@aimuzov/infra-site-kit/ui/card.svelte'
	import Skeleton from '@aimuzov/infra-site-kit/ui/skeleton.svelte'

	import { pt } from '@aimuzov/infra-mcp-kit/astro/lib/i18n.ts'

	let { locale = 'ru' }: { locale?: string } = $props()

	// Вход в кабинет, а не OAuth клиента: виджет ведёт на /account/login, и сервер ставит cookie.
	type Auth = { botName: string; dev: string | null }

	let auth = $state<Auth | null>(null)
	let failed = $state(false)
	let widget = $state<HTMLElement>()

	$effect(() => {
		fetch('/account/auth', { headers: { accept: 'application/json' } })
			.then((res) => (res.ok ? (res.json() as Promise<Auth>) : Promise.reject(new Error(String(res.status)))))
			.then((data) => (auth = data))
			.catch(() => (failed = true))
	})

	// Скрипт виджета вставляем сами: имя бота приходит с сервера, на сборке страницы его нет.
	$effect(() => {
		if (!widget || !auth || auth.dev) return

		const script = document.createElement('script')

		script.async = true
		script.src = 'https://telegram.org/js/telegram-widget.js?22'
		script.dataset.telegramLogin = auth.botName
		script.dataset.size = 'large'
		script.dataset.authUrl = new URL('/account/login', location.origin).href
		widget.append(script)

		return () => script.remove()
	})
</script>

<div class="auth">
	<Card>
		<p class="eyebrow">{pt(locale, 'thinks.signin.eyebrow')}</p>
		<h1>{pt(locale, 'thinks.signin.title')}</h1>
		<p class="muted">{pt(locale, 'thinks.signin.text')}</p>
		{#if failed}
			<Alert variant="danger" title={pt(locale, 'thinks.signin.failed')}
				>{pt(locale, 'thinks.signin.failedText')}</Alert
			>
		{:else if !auth}
			<Skeleton height="2.5rem" width="14rem" />
		{:else if auth.dev}
			<a class="signin__dev" href="/account/login?dev=1">{pt(locale, 'thinks.signin.dev', { id: auth.dev })}</a>
		{:else}
			<div class="signin__widget" bind:this={widget}></div>
		{/if}
		<p class="signin__note">{pt(locale, 'thinks.signin.note')}</p>
	</Card>
</div>

<style>
	.signin__widget {
		min-height: 40px;
	}

	.signin__note {
		font-size: 13px;
		color: var(--ui-muted);
	}

	.signin__dev {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 2.75rem;
		border-radius: var(--ui-radius-sm);
		font-weight: 600;
		color: #fff;
		text-decoration: none;
		background: #2aabee;

		&:hover {
			color: #fff;
			background: #1e96d4;
		}
	}
</style>
