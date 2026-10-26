<script lang="ts">
	import type { PagesTool } from '@aimuzov/infra-mcp-kit/astro'
	import Card from '@aimuzov/infra-site-kit/ui/card.svelte'

	import { pt } from '@aimuzov/infra-mcp-kit/astro/lib/i18n.ts'

	let { tools, locale = 'ru' }: { tools: Array<string | PagesTool>; locale?: string } = $props()

	const labels = $derived(tools.map((tool) => (typeof tool === 'string' ? tool : tool.label)))
</script>

<Card>
	<h2 class="section-title">{pt(locale, 'tools.title')}</h2>
	<ul class="chips">
		{#each labels as label (label)}
			<li><code>{label}</code></li>
		{/each}
	</ul>
</Card>
