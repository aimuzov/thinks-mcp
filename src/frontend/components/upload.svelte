<script lang="ts">
	import Upload from '@lucide/svelte/icons/upload'

	import Card from '@aimuzov/infra-site-kit/ui/card.svelte'
	import Dropzone from '@aimuzov/infra-site-kit/ui/dropzone.svelte'
	import { formatSize } from '@aimuzov/infra-site-kit/ui/files.js'

	import type { AccountState } from '#thinks/http/app'
	import SectionHeading from './section-heading.svelte'
	import { readError } from '#frontend/lib/api.ts'
	import { pt } from '@aimuzov/infra-mcp-kit/astro/lib/i18n.ts'

	let {
		account,
		reload,
		locale = 'ru',
	}: { account: AccountState; reload: () => Promise<void>; locale?: string } = $props()

	let sent = $state<number | null>(null)
	let error = $state<string | null>(null)

	const building = $derived(account.status?.state === 'queued' || account.status?.state === 'building')

	function send(file: File) {
		error = null
		sent = 0

		// XHR, а не fetch: только он отдаёт прогресс отправки, а выгрузка бывает в гигабайт.
		const xhr = new XMLHttpRequest()

		xhr.open('PUT', '/account/upload')
		xhr.setRequestHeader('content-type', 'application/octet-stream')
		xhr.setRequestHeader('accept', 'application/json')

		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) sent = event.loaded / event.total
		}

		xhr.onload = async () => {
			if (xhr.status < 300) {
				await reload()
			} else {
				error = await readError(new Response(xhr.responseText, { status: xhr.status }))
			}

			sent = null
		}

		xhr.onerror = () => {
			error = pt(locale, 'thinks.upload.broken')
			sent = null
		}

		xhr.send(file)
	}
</script>

<Card>
	<SectionHeading icon={Upload} text={pt(locale, 'thinks.upload')} />
	<ol class="steps">
		<li>
			<b>{pt(locale, 'thinks.upload.export')}</b><span>{pt(locale, 'thinks.upload.exportText')}</span>
		</li>
		<li>
			<b>{pt(locale, 'thinks.upload.format')}</b><span>{pt(locale, 'thinks.upload.formatText')}</span>
		</li>
		<li>
			<b>{pt(locale, 'thinks.upload.load')}</b><span
				>{pt(locale, 'thinks.upload.loadBefore')} <code>result.json</code>{locale === 'ru'
					? ''
					: ' here'}.</span
			>
		</li>
	</ol>
	{#if sent !== null}
		<div class="upload__progress" role="status" aria-live="polite">
			<p class="muted">{pt(locale, 'thinks.upload.progress', { percent: Math.round(sent * 100) })}</p>
			<div
				class="upload__bar"
				role="progressbar"
				aria-label={pt(locale, 'thinks.upload.progressLabel')}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(sent * 100)}
			>
				<span style:--done={`${sent * 100}%`}></span>
			</div>
		</div>
	{:else}
		<Dropzone
			size="lg"
			accept=".json,application/json"
			maxSize={account.maxUploadBytes}
			disabled={building}
			title={building ? pt(locale, 'thinks.upload.wait') : pt(locale, 'thinks.upload.drop')}
			note={pt(locale, 'thinks.upload.limit', { size: formatSize(account.maxUploadBytes, locale) })}
			button={pt(locale, 'thinks.upload.choose')}
			label={pt(locale, 'thinks.upload')}
			{locale}
			{error}
			onfile={send}
		/>
	{/if}
	<p class="upload__note">
		{pt(locale, 'thinks.upload.note')}
	</p>
</Card>

<style>
	.upload__progress {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 20px;
		border: 1px dashed var(--ui-border);
		border-radius: var(--ui-radius);

		& p {
			margin: 0;
		}
	}

	.upload__bar {
		overflow: hidden;
		height: 6px;
		border-radius: 999px;
		background: var(--ui-border);

		& span {
			display: block;
			width: var(--done, 0%);
			height: 100%;
			border-radius: inherit;
			background: var(--ui-fg);
			transition: width 0.2s linear;
		}
	}

	.upload__note {
		margin: 0;
		font-size: 13px;
		color: var(--ui-muted);
	}
</style>
