import { build } from 'bun';

const entrypoints = ['./src/server.ts', './src/clientjs.ts', './src/middleware.ts'];
const external = ['@hyperspan/html'];
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
