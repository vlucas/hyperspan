import dts from 'bun-plugin-dts';

await Promise.all([
  // Build JS
  Bun.build({
    entrypoints: ['./src/index.ts'],
    outdir: './dist',
    target: 'browser',
  }),
  Bun.build({
    entrypoints: ['./src/server.ts'],
    outdir: './dist',
    target: 'node',
  }),

  // Build type files for TypeScript
  Bun.build({
    entrypoints: ['./src/index.ts'],
    outdir: './dist',
    target: 'browser',
    plugins: [dts()],
  }),
  Bun.build({
    entrypoints: ['./src/server.ts'],
    outdir: './dist',
    target: 'node',
    plugins: [dts()],
  }),
]);
