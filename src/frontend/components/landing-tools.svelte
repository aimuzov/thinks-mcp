<script lang="ts">
	import Card from '@aimuzov/infra-site-kit/ui/card.svelte'

	let { tools }: { tools: string[] } = $props()
</script>

<Card>
	<h2 class="section-title">Инструменты</h2>
	<ul class="chips">
		{#each tools as tool (tool)}
			<li><code>{tool}</code></li>
		{/each}
	</ul>
</Card>
