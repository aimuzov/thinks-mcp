import { vitePreprocess } from '@astrojs/svelte'

// Как у сайтов: стили компонентов проходят через PostCSS проекта до компилятора Svelte.
export default { preprocess: vitePreprocess() }
