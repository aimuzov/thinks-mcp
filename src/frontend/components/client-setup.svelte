<script lang="ts">
	import Card from '@aimuzov/infra-site-kit/ui/card.svelte'
	import CopyPlate from '@aimuzov/infra-mcp-kit/astro/components/copy-plate.svelte'
	import { pt } from '@aimuzov/infra-mcp-kit/astro/lib/i18n.ts'

	let { locale }: { locale: string } = $props()
	let url = $state('…/mcp')

	$effect(() => {
		url = new URL('/mcp', location.origin).href
	})

	const clients = $derived([
		{
			name: 'Codex',
			hint: 'thinks.clients.codex',
			config: `codex mcp add thinks --url ${url}`,
			login: 'codex mcp login thinks',
		},
		{
			name: 'Cursor',
			hint: 'thinks.clients.cursor',
			config: JSON.stringify({ mcpServers: { thinks: { url } } }),
		},
		{ name: 'VS Code / GitHub Copilot', hint: 'thinks.clients.vscode' },
		{
			name: 'OpenCode',
			hint: 'thinks.clients.opencode',
			config: JSON.stringify({ mcp: { thinks: { type: 'remote', url } } }),
			login: 'opencode mcp auth thinks',
		},
	])
</script>

<Card>
	<h2 class="section-title">{pt(locale, 'thinks.clients.title')}</h2>
	{#each clients as client (client.name)}
		<details>
			<summary>{client.name}</summary>
			{#if client.name === 'Codex' && client.config}
				<CopyPlate value={client.config} label={client.name} {locale} small />
			{/if}
			<p>{pt(locale, client.hint)}</p>
			{#if client.name !== 'Codex' && client.config}
				<CopyPlate value={client.config} label={client.name} {locale} small />
			{/if}
			{#if client.login}
				<CopyPlate value={client.login} label={pt(locale, 'connect.command')} {locale} small />
			{/if}
		</details>
	{/each}
</Card>

<style>
	details {
		display: grid;
		min-width: 0;
		margin-top: 12px;
	}

	summary {
		cursor: pointer;
		font-weight: 600;
	}

	details > :global(.plate) {
		margin-top: 8px;
	}

	p {
		margin: 8px 0;
		color: var(--ui-muted);
	}
</style>
