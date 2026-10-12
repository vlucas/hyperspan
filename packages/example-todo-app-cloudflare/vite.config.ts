import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { hyperspan } from '@hyperspan/vite-plugin';

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(import.meta.dirname),
    },
  },
  plugins: [tailwindcss(), ...hyperspan()],
});
