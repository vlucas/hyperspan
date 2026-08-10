import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { hyperspan } from '@hyperspan/vite-plugin';
import { preactVitePlugin } from '@hyperspan/plugin-preact';
import { svelteVitePlugin } from '@hyperspan/plugin-svelte';
import { vueVitePlugin } from '@hyperspan/plugin-vue';

export default defineConfig({
  plugins: [
    tailwindcss(),
    ...hyperspan({
      vitePlugins: [preactVitePlugin(), svelteVitePlugin(), vueVitePlugin()],
    }),
  ],
  server: {
    port: Number(process.env.PORT) || 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
