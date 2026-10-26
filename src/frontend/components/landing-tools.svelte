<script lang="ts">
	import type { PagesTool } from '@aimuzov/infra-mcp-kit/astro'
	import Card from '@aimuzov/infra-site-kit/ui/card.svelte'

	let { tools }: { tools: Array<string | PagesTool> } = $props()

	const labels = $derived(tools.map((tool) => (typeof tool === 'string' ? tool : tool.label)))
</script>

<Card>
	<h2 class="section-title">Инструменты</h2>
	<ul class="chips">
		{#each labels as label (label)}
			<li><code>{label}</code></li>
		{/each}
	</ul>
</Card>
