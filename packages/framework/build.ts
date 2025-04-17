import {build} from 'bun';
import dts from 'bun-plugin-dts';

const entrypoints = ['./src/server.ts', './src/assets.ts'];
const external = ['@hyperspan/html'];
const outdir = './dist';
const target = 'node';
const splitting = true;

await Promise.all([
  // Build JS
  build({
    entrypoints,
    external,
    outdir,
    target,
    splitting,
  }),

  // Build type files for TypeScript
  build({
    entrypoints,
    external,
    outdir,
    target,
    splitting,
    plugins: [dts()],
  }),
]);
