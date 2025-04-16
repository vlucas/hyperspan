import {build} from 'bun';
import dts from 'bun-plugin-dts';

const filesToBuild = ['./src/index.ts', './src/server.ts', './src/assets.ts'];
const outdir = './dist';
const target = 'node';

await Promise.all(
  filesToBuild.map((file) =>
    Promise.all([
      // Build JS
      build({
        entrypoints: [file],
        outdir,
        target,
      }),

      // Build type files for TypeScript
      build({
        entrypoints: [file],
        outdir,
        target,
        plugins: [dts()],
      }),
    ])
  )
);
