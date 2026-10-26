<script lang="ts">
	import Database from '@lucide/svelte/icons/database'
	import LogOut from '@lucide/svelte/icons/log-out'
	import Trash from '@lucide/svelte/icons/trash-2'

	import Alert from '@aimuzov/infra-site-kit/ui/alert.svelte'
	import Button from '@aimuzov/infra-site-kit/ui/button.svelte'
	import Card from '@aimuzov/infra-site-kit/ui/card.svelte'

	import AccountShell from '@aimuzov/infra-mcp-kit/astro/components/account-shell.svelte'
	import Connect from '@aimuzov/infra-mcp-kit/astro/components/connect.svelte'
	import { pt } from '@aimuzov/infra-mcp-kit/astro/lib/i18n.ts'
	import { localizePath } from '@aimuzov/infra-site-kit/i18n.js'

	import type { AccountState } from '#thinks/http/app'
	import SectionHeading from './section-heading.svelte'
	import { post } from '#frontend/lib/api.ts'
	import CorpusStatus from './corpus-status.svelte'
	import Settings from './settings.svelte'
	import Upload from './upload.svelte'

	let { locale = 'ru' }: { locale?: string } = $props()

	let leaving = $state<'delete' | 'logout' | null>(null)
	let error = $state<string | null>(null)

	async function leave(kind: 'delete' | 'logout') {
		if (kind === 'delete' && !confirm(pt(locale, 'thinks.deleteConfirm'))) return

		leaving = kind
		error = null

		const result = await post(kind === 'delete' ? '/account/delete' : '/account/logout')

		if (result.ok) location.assign(localizePath(kind === 'delete' ? '/' : '/account', locale))
		else {
			error = result.message
			leaving = null
		}
	}
</script>

<AccountShell login={localizePath('/account/signin', locale)} guest={pt(locale, 'thinks.guest')} {locale}>
	{#snippet children(account: AccountState, reload: () => Promise<void>)}
		<div class="account">
			<CorpusStatus {account} {reload} {locale} />
			<Upload {account} {reload} {locale} />
			<Connect name="thinks" {locale} />
			<Settings {account} {locale} />
			<Card tone="danger">
				<SectionHeading icon={Database} text={pt(locale, 'thinks.data')} />
				<p class="muted">{pt(locale, 'thinks.dataText')}</p>
				{#if account.busy}
					<p class="account__note">{pt(locale, 'thinks.busy')}</p>
				{/if}
				{#if error}<Alert variant="danger">{error}</Alert>{/if}
				<div class="actions account__leave">
					<Button
						variant="danger"
						disabled={account.busy || leaving !== null}
						onclick={() => leave('delete')}
					>
						<Trash size={16} />
						{leaving === 'delete' ? pt(locale, 'thinks.deleting') : pt(locale, 'thinks.delete')}
					</Button>
					<Button variant="outline" disabled={leaving !== null} onclick={() => leave('logout')}>
						<LogOut size={16} />
						{pt(locale, 'thinks.logout')}
					</Button>
				</div>
			</Card>
		</div>
	{/snippet}
</AccountShell>

<style>
	.account {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.account__note {
		margin: 0;
		font-size: 13px;
		color: var(--ui-muted);
	}

	/* На телефоне кнопки не помещаются в строку: стопкой во всю ширину они одного размера. */
	@media (max-width: 480px) {
		.account__leave {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
