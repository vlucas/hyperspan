import { build } from 'esbuild';

await build({
  entryPoints: ['./src/html.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'es2020',
  bundle: true,
});
