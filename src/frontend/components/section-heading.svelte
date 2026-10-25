<script lang="ts">
	import type { Component } from 'svelte'

	// Заголовок карточки как у карточек кита (`section-title`), но с иконкой: так кабинет
	// и «Подключить» из кита читаются одной системой.
	let { icon: Icon, text }: { icon: Component<{ size?: number }>; text: string } = $props()
</script>

<h2 class="section-title heading"><Icon size={14} />{text}</h2>

<style>
	.heading {
		display: flex;
		gap: 8px;
		align-items: center;
	}
</style>
