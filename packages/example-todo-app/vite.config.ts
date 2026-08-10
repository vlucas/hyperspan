import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { hyperspan } from '@hyperspan/vite-plugin';
import { preactVitePlugin } from '@hyperspan/plugin-preact';

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(import.meta.dirname),
    },
  },
  plugins: [
    tailwindcss(),
    ...hyperspan({
      vitePlugins: [preactVitePlugin()],
    }),
  ],
  server: {
    port: Number(process.env.PORT) || 5173,
  },
});
