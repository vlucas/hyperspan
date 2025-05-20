import { build } from 'bun';

const entrypoints = ['./src/server.ts', './src/assets.ts'];
const external = ['@hyperspan/html', 'preact', 'preact-render-to-string'];
const outdir = './dist';
const target = 'node';
const splitting = true;

// Build JS
await build({
  entrypoints,
  external,
  outdir,
  target,
  splitting,
});
