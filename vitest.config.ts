import { defineConfig } from 'vitest/config';
import { importMetaResolvePlugin } from './packages/vite-plugin/src/import-meta-resolve';

export default defineConfig({
  plugins: [importMetaResolvePlugin()],
  test: {
    include: ['packages/**/src/**/*.test.ts'],
    environment: 'node',
  },
});
