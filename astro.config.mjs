// Страницы размещённого коннектора: лендинг, вход и ошибки -- из infra-mcp-kit, кабинет -- свой.
// Astro собирает их в build/public, а express отдаёт оттуда файлы как есть.
import mcpPages from '@aimuzov/infra-mcp-kit/astro'
import svelte from '@astrojs/svelte'
import { defineConfig } from 'astro/config'

import strings from './src/frontend/strings.mjs'

export default defineConfig({
	srcDir: './src/frontend',
	outDir: './build/public',
	integrations: [
		svelte(),
		mcpPages({
			service: {
				name: 'thinks',
				repo: 'https://github.com/aimuzov/thinks-mcp',
				tagline: 'Пишет, отвечает и переформулирует твоим голосом',
				lead: 'MCP-коннектор, который учится по твоей переписке в Telegram. Сам он ничего не генерирует: отдаёт модели стиль-профиль и твои настоящие сообщения под запрос.',
				tools: ['write_as_me', 'reply_as_me', 'rephrase_as_me', 'check_as_me', 'find_my_messages'],
				strings,
			},
			telegram: {
				// Имя бота видно всем на странице входа, секрет -- только его токен. Страница
				// собирается без окружения прода, поэтому имя по умолчанию -- боевое.
				botName: process.env.TELEGRAM_BOT_NAME || 'thinksmcpbot',
				grants: ['Читать стиль-профиль', 'Искать по твоим сообщениям', 'Проверять тексты на похожесть'],
			},
			// Лендинг свой: ему нужна дорога в кабинет, см. src/frontend/pages/index.astro.
			override: ['index'],
			locales: ['ru', 'en'],
		}),
	],
})
