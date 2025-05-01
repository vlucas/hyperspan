import { build } from 'bun';

await build({
  entrypoints: ['./src/index.ts'],
  external: ['bun', '@hyperspan/html', '@hyperspan/framework'],
  outdir: './dist',
  target: 'node',
});
