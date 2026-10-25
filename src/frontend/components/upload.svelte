<script lang="ts">
	import Upload from '@lucide/svelte/icons/upload'

	import Card from '@aimuzov/infra-site-kit/ui/card.svelte'
	import Dropzone from '@aimuzov/infra-site-kit/ui/dropzone.svelte'
	import { formatSize } from '@aimuzov/infra-site-kit/ui/files.js'

	import type { AccountState } from '#thinks/http/app'
	import SectionHeading from './section-heading.svelte'
	import { readError } from '#frontend/lib/api.ts'

	let { account, reload }: { account: AccountState; reload: () => Promise<void> } = $props()

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
			error = 'Соединение оборвалось, загрузи файл ещё раз'
			sent = null
		}

		xhr.send(file)
	}
</script>

<Card>
	<SectionHeading icon={Upload} text="Выгрузка из Telegram" />
	<ol class="steps">
		<li>
			<b>Экспорт</b><span>Telegram Desktop: Settings → Advanced → Export Telegram data.</span>
		</li>
		<li>
			<b>Формат</b><span>Machine-readable JSON, все медиа выключить: нужен только текст.</span>
		</li>
		<li>
			<b>Загрузка</b><span>Перетащи сюда получившийся <code>result.json</code>.</span>
		</li>
	</ol>
	{#if sent !== null}
		<div class="upload__progress" role="status" aria-live="polite">
			<p class="muted">Загружаю выгрузку: {Math.round(sent * 100)}%</p>
			<div
				class="upload__bar"
				role="progressbar"
				aria-label="Загрузка выгрузки"
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
			title={building ? 'Дождись конца сборки' : 'Перетащи result.json сюда'}
			note={`JSON до ${formatSize(account.maxUploadBytes)}`}
			button="Выбрать файл"
			label="Выгрузка из Telegram"
			{error}
			onfile={send}
		/>
	{/if}
	<p class="upload__note">
		Выгрузка удаляется сразу после сборки. Новая сборка заменяет старый корпус, только если прошла успешно.
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
