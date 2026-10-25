<script lang="ts">
	import Card from '@aimuzov/infra-site-kit/ui/card.svelte'

	// Карточки лендинга -- Svelte, а не разметка в .astro: Card из site-kit ждёт сниппет,
	// и слот Astro его типы не принимают. Рендерятся на сборке, без гидрации.
</script>

<Card>
	<h2 class="section-title">Сначала кабинет</h2>
	<p class="muted">
		Коннектору нужен твой корпус. Войди через Telegram, загрузи выгрузку переписки и&nbsp;дождись сборки, потом
		подключай.
	</p>
	<div class="actions">
		<a class="landing__account" href="/account">Открыть кабинет</a>
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
