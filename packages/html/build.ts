import { build } from 'bun';

await build({
  entrypoints: ['./src/html.ts'],
  outdir: './dist',
  target: 'browser',
});
