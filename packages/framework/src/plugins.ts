import type { Hyperspan as HS } from './types';
import { JS_PUBLIC_PATH, JS_IMPORT_MAP } from './client/js';
import { assetHash } from './utils';
import { IS_PROD } from './server';
import { join } from 'node:path';

export const CSS_PUBLIC_PATH = '/_hs/css';
const CLIENT_JS_CACHE = new Map<string, string>();
const EXPORT_REGEX = /export\{(.*)\}/g;

/**
 * Hyperspan Client JS Plugin
 */
export function clientJSPlugin(): HS.Plugin {
  return async (config: HS.Config) => {
    // Define a Bun plugin to handle .client.ts files
    await Bun.plugin({
      name: 'Hyperspan Client JS Loader',
      async setup(build) {
        // when a .client.ts file is imported...
        build.onLoad({ filter: /\.client\.ts$/ }, async (args) => {
          const jsId = assetHash(args.path);

          // Cache: Avoid re-processing the same file
          if (IS_PROD && CLIENT_JS_CACHE.has(jsId)) {
            return {
              contents: CLIENT_JS_CACHE.get(jsId) || '',
              loader: 'js',
            };
          }

          // We need to build the file to ensure we can ship it to the client with dependencies
          // Ironic, right? Calling Bun.build() inside of a plugin that runs on Bun.build()?
          const result = await Bun.build({
            entrypoints: [args.path],
            outdir: join(config.publicDir, JS_PUBLIC_PATH),
            naming: IS_PROD ? '[dir]/[name]-[hash].[ext]' : undefined,
            external: Array.from(JS_IMPORT_MAP.keys()),
            minify: IS_PROD,
            format: 'esm',
            target: 'browser',
            env: 'APP_PUBLIC_*',
          });

          // Add output file to import map
          const esmName = String(result.outputs[0].path.split('/').reverse()[0]).replace('.js', '');
          JS_IMPORT_MAP.set(esmName, `${JS_PUBLIC_PATH}/${esmName}.js`);

          const contents = await result.outputs[0].text();
          const exportLine = EXPORT_REGEX.exec(contents);

          let exports = '{}';
          if (exportLine) {
            const exportName = exportLine[1];
            exports =
              '{' +
              exportName
                .split(',')
                .map((name) => name.trim().split(' as '))
                .map(([name, alias]) => `${alias === 'default' ? 'default as ' + name : alias}`)
                .join(', ') +
              '}';
          }
          const fnArgs = exports.replace(/(\w+)\s*as\s*(\w+)/g, '$1: $2');

          // Export a special object that can be used to render the client JS as a script tag
          const moduleCode = `// hyperspan:processed
import { functionToString } from '@hyperspan/framework/client/js';

// Original file contents
${contents}

// hyperspan:client-js-plugin
export const __CLIENT_JS = {
  id: "${jsId}",
  esmName: "${esmName}",
  sourceFile: "${args.path}",
  outputFile: "${result.outputs[0].path}",
  renderScriptTag: ({ loadScript }) => {
    const fn = loadScript ? (typeof loadScript === 'string' ? loadScript : \`const fn = \${functionToString(loadScript)}; fn(${fnArgs});\`) : '';
    return \`<script type="module" data-source-id="${jsId}">import ${exports} from "${esmName}";\n\${fn}</script>\`;
  },
}
`;

          CLIENT_JS_CACHE.set(jsId, moduleCode);

          return {
            contents: moduleCode,
            loader: 'js',
          };
        });
      },
    });
  };
}