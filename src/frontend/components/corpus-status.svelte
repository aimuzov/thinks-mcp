<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check'
	import FileUp from '@lucide/svelte/icons/file-up'
	import LoaderCircle from '@lucide/svelte/icons/loader-circle'
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert'

	import Card from '@aimuzov/infra-site-kit/ui/card.svelte'

	import type { AccountState } from '#thinks/http/app'
	import { pt } from '@aimuzov/infra-mcp-kit/astro/lib/i18n.ts'

	let {
		account,
		reload,
		locale = 'ru',
	}: { account: AccountState; reload: () => Promise<void>; locale?: string } = $props()

	const kind = $derived.by(() => {
		const s = account.status?.state

		if (s === 'queued' || s === 'building' || s === 'failed') return s

		return account.hasCorpus ? 'ready' : 'empty'
	})

	const busy = $derived(kind === 'queued' || kind === 'building')
	const step = $derived(account.status?.step ?? 0)
	const steps = $derived(account.status?.steps ?? 5)

	// Сборка идёт в отдельном процессе на сервере: пока она не кончится, спрашиваем статус сами.
	$effect(() => {
		if (!busy) return

		const timer = setInterval(() => void reload(), 3000)

		return () => clearInterval(timer)
	})

	const when = (ms: number) =>
		new Date(ms).toLocaleString(locale, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
</script>

<Card>
	<div class="status status--{kind}" role="status" aria-live="polite">
		<span class="status__icon" aria-hidden="true">
			{#if kind === 'ready'}<CircleCheck size={22} />
			{:else if kind === 'failed'}<TriangleAlert size={22} />
			{:else if busy}<LoaderCircle size={22} class="status__spin" />
			{:else}<FileUp size={22} />{/if}
		</span>
		<div class="status__body">
			{#if kind === 'ready'}
				<h2 class="status__title">{pt(locale, 'thinks.status.ready')}</h2>
				<p class="muted">
					{pt(locale, 'thinks.status.readyText')}{#if account.status}{pt(locale, 'thinks.status.readyAt', {
							when: when(account.status.updatedAt),
						})}{/if}.
				</p>
			{:else if kind === 'failed'}
				<h2 class="status__title">{pt(locale, 'thinks.status.failed')}</h2>
				<p class="muted">{(locale === 'en' && account.status?.messageEn) || account.status?.message}</p>
				<p class="muted">
					{account.hasCorpus ? pt(locale, 'thinks.status.kept') : pt(locale, 'thinks.status.again')}
				</p>
			{:else if kind === 'queued'}
				<h2 class="status__title">{pt(locale, 'thinks.status.queued')}</h2>
				<p class="muted">{pt(locale, 'thinks.status.queuedText')}</p>
				<div class="bar bar--wait" aria-hidden="true"><span></span></div>
			{:else if kind === 'building'}
				<h2 class="status__title">{pt(locale, 'thinks.status.building')}</h2>
				<!-- Шаг берём по номеру из словаря: сервер хранит его текст по-русски. -->
				<p class="muted">
					{step > 0 ? pt(locale, `thinks.step.${step}`) : pt(locale, 'thinks.status.starting')}.
					{pt(locale, 'thinks.status.step', { step: Math.max(step, 1), steps })}
				</p>
				<div
					class="bar"
					role="progressbar"
					aria-label={pt(locale, 'thinks.status.buildLabel')}
					aria-valuemin={0}
					aria-valuemax={steps}
					aria-valuenow={step}
				>
					<span style:--done={`${(Math.max(step, 0.3) / steps) * 100}%`}></span>
				</div>
			{:else}
				<h2 class="status__title">{pt(locale, 'thinks.status.empty')}</h2>
				<p class="muted">{pt(locale, 'thinks.status.emptyText')}</p>
			{/if}
		</div>
	</div>
</Card>

<style>
	.status {
		display: flex;
		gap: 14px;
		align-items: flex-start;
	}

	.status__icon {
		display: inline-flex;
		flex: none;
		padding-top: 2px;
		color: var(--ui-muted);
	}

	.status--ready .status__icon {
		color: var(--ui-accent);
	}

	.status--failed .status__icon {
		color: var(--ui-danger);
	}

	.status--queued .status__icon,
	.status--building .status__icon {
		color: var(--ui-fg);
	}

	.status__body {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.status__title {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
	}

	.status__body :global(p) {
		margin: 0;
	}

	.status :global(.status__spin) {
		animation: spin 1.2s linear infinite;
	}

	.bar {
		overflow: hidden;
		height: 6px;
		margin-top: 8px;
		border-radius: 999px;
		background: var(--ui-border);

		& span {
			display: block;
			width: var(--done, 0%);
			height: 100%;
			border-radius: inherit;
			background: var(--ui-fg);
			transition: width 0.6s ease;
		}
	}

	.bar--wait span {
		width: 30%;
		animation: wait 1.6s ease-in-out infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes wait {
		from {
			transform: translateX(-100%);
		}

		to {
			transform: translateX(340%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.status :global(.status__spin),
		.bar--wait span {
			animation: none;
		}
	}
</style>
