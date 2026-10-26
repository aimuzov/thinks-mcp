<script lang="ts">
	import Check from '@lucide/svelte/icons/check'
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'

	import Alert from '@aimuzov/infra-site-kit/ui/alert.svelte'
	import Button from '@aimuzov/infra-site-kit/ui/button.svelte'
	import Card from '@aimuzov/infra-site-kit/ui/card.svelte'
	import Field from '@aimuzov/infra-site-kit/ui/field.svelte'
	import Input from '@aimuzov/infra-site-kit/ui/input.svelte'

	import type { AccountState } from '#thinks/http/app'
	import SectionHeading from './section-heading.svelte'
	import { post } from '#frontend/lib/api.ts'
	import { pt } from '@aimuzov/infra-mcp-kit/astro/lib/i18n.ts'

	let { account, locale = 'ru' }: { account: AccountState; locale?: string } = $props()

	// Форма держит свою копию: опрос статуса сборки не должен затирать то, что человек печатает.
	// svelte-ignore state_referenced_locally
	const initial = account.settings
	let neverMarks = $state(initial.neverMarks)
	let chatStopList = $state(initial.chatStopList)
	let recentYears = $state(String(initial.recentYears))
	let voice = $state(initial.voice)

	let saving = $state(false)
	let saved = $state(false)
	let error = $state<string | null>(null)

	async function save(event: SubmitEvent) {
		event.preventDefault()
		saving = true
		saved = false
		error = null

		const result = await post<AccountState>('/account/settings', {
			neverMarks,
			chatStopList,
			recentYears: Number(recentYears),
			voice,
		})

		saving = false

		if (!result.ok) return void (error = result.message)

		// Сервер мог поправить ввод, например годы вне 1..20.
		recentYears = String(result.data.settings.recentYears)
		saved = true
	}
</script>

<Card>
	<SectionHeading icon={SlidersHorizontal} text={pt(locale, 'thinks.settings')} />
	<form class="settings" onsubmit={save} oninput={() => (saved = false)}>
		<section class="settings__group">
			<h3 class="settings__title">{pt(locale, 'thinks.settings.writing')}</h3>
			<p class="settings__note">{pt(locale, 'thinks.settings.now')}</p>
			<Field label={pt(locale, 'thinks.settings.neverMarks')} for="never-marks" {locale}>
				<Input id="never-marks" name="neverMarks" placeholder={'—:--,…:...,«:",»:"'} bind:value={neverMarks} />
			</Field>
		</section>

		<section class="settings__group">
			<h3 class="settings__title">{pt(locale, 'thinks.settings.corpus')}</h3>
			<p class="settings__note">{pt(locale, 'thinks.settings.nextBuild')}</p>
			<Field label={pt(locale, 'thinks.settings.stopList')} for="chat-stop-list" {locale}>
				<Input id="chat-stop-list" name="chatStopList" bind:value={chatStopList} />
			</Field>
			<Field label={pt(locale, 'thinks.settings.recent')} for="recent-years" {locale}>
				<Input id="recent-years" name="recentYears" type="number" min="1" max="20" bind:value={recentYears} />
			</Field>
		</section>

		<section class="settings__group">
			<h3 class="settings__title">{pt(locale, 'thinks.settings.voice')}</h3>
			<label class="settings__check">
				<input type="checkbox" name="voice" bind:checked={voice} />
				<span>{pt(locale, 'thinks.settings.voiceOn')}</span>
			</label>
			<p class="settings__note">{pt(locale, 'thinks.settings.voiceNote')}</p>
		</section>

		{#if error}<Alert variant="danger">{error}</Alert>{/if}
		<div class="actions">
			<Button type="submit" disabled={saving}
				>{saving ? pt(locale, 'thinks.settings.saving') : pt(locale, 'thinks.settings.save')}</Button
			>
			{#if saved}<span class="settings__saved" role="status"
					><Check size={16} /> {pt(locale, 'thinks.settings.saved')}</span
				>{/if}
		</div>
	</form>
</Card>

<style>
	.settings {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.settings__group {
		display: flex;
		flex-direction: column;
		gap: 12px;

		& + & {
			padding-top: 20px;
			border-top: 1px solid var(--ui-border);
		}
	}

	.settings__title {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}

	.settings__note {
		margin: -6px 0 0;
		font-size: 13px;
		color: var(--ui-muted);
	}

	.settings__check {
		display: flex;
		gap: 10px;
		align-items: center;
		cursor: pointer;

		& input {
			width: 18px;
			height: 18px;
			margin: 0;
			accent-color: var(--ui-fg);
		}
	}

	.settings__saved {
		display: inline-flex;
		gap: 6px;
		align-items: center;
		font-size: 14px;
		color: var(--ui-muted);
	}
</style>
