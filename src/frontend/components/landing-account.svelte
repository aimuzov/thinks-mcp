<script lang="ts">
	import Card from '@aimuzov/infra-site-kit/ui/card.svelte'
	import { localizePath } from '@aimuzov/infra-site-kit/i18n.js'

	import { pt } from '@aimuzov/infra-mcp-kit/astro/lib/i18n.ts'

	let { locale = 'ru' }: { locale?: string } = $props()

	// Карточки лендинга -- Svelte, а не разметка в .astro: Card из site-kit ждёт сниппет,
	// и слот Astro его типы не принимают. Рендерятся на сборке, без гидрации.
</script>

<Card>
	<h2 class="section-title">{pt(locale, 'thinks.landing.title')}</h2>
	<p class="muted">{pt(locale, 'thinks.landing.text')}</p>
	<div class="actions">
		<a class="landing__account" href={localizePath('/account', locale)}>{pt(locale, 'thinks.landing.open')}</a>
	</div>
</Card>

<style>
	/* Ссылка в виде главной кнопки, как вход в AccountShell кита: это переход, а не действие. */
	.landing__account {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 2.75rem;
		padding: 0 1.5rem;
		border-radius: var(--ui-radius-sm);
		font-weight: 500;
		color: var(--ui-primary-fg);
		text-decoration: none;
		background: var(--ui-primary);
		box-shadow:
			-2px 0 0 var(--signal-red),
			2px 0 0 var(--signal-cyan);

		&:hover {
			color: var(--ui-primary-fg);
		}
	}
</style>
