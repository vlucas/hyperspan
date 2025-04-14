import dts from 'bun-plugin-dts';

await Promise.all([
  // Build JS
  Bun.build({
    entrypoints: ['./src/html.ts'],
    outdir: './dist',
    target: 'browser',
  }),

  // Build type files for TypeScript
  Bun.build({
    entrypoints: ['./src/html.ts'],
    outdir: './dist',
    target: 'browser',
    plugins: [dts()],
  }),
]);
