import { html } from '@hyperspan/html';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Hyperspan as HS } from './types';

const IS_PROD = process.env.NODE_ENV === 'production';

export const CLIENTJS_PUBLIC_PATH = '/_hs/js';
export const ISLAND_PUBLIC_PATH = '/_hs/js/islands';
export const clientImportMap = new Map<string, string>();

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
            outdir: join(config.publicDir, CLIENTJS_PUBLIC_PATH),
            naming: IS_PROD ? '[dir]/[name]-[hash].[ext]' : undefined,
            external: Array.from(clientImportMap.keys()),
            minify: true,
            format: 'esm',
            target: 'browser',
            env: 'APP_PUBLIC_*',
          });

          // Add output file to import map
          const esmName = String(result.outputs[0].path.split('/').reverse()[0]).replace('.js', '');
          clientImportMap.set(esmName, `${CLIENTJS_PUBLIC_PATH}/${esmName}.js`);

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
import { functionToString } from '@hyperspan/framework/assets';

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

/**
 * Render a client JS module as a script tag
 */
export function renderClientJS<T>(module: T, loadScript?: ((module: T) => void) | string) {
  // @ts-ignore
  if (!module.__CLIENT_JS) {
    throw new Error(
      `[Hyperspan] Client JS was not loaded by Hyperspan! Ensure the filename ends with .client.ts to use this render method.`
    );
  }

  return html.raw(
    // @ts-ignore
    module.__CLIENT_JS.renderScriptTag({
      loadScript: loadScript
        ? typeof loadScript === 'string'
          ? loadScript
          : functionToString(loadScript)
        : undefined,
    })
  );
}

/**
 * Convert a function to a string (results in loss of context!)
 * Handles named, async, and arrow functions
 */
export function functionToString(fn: any) {
  let str = fn.toString().trim();

  // Ensure consistent output & handle async
  if (!str.includes('function ')) {
    if (str.includes('async ')) {
      str = 'async function ' + str.replace('async ', '');
    } else {
      str = 'function ' + str;
    }
  }

  const lines = str.split('\n');
  const firstLine = lines[0];
  const lastLine = lines[lines.length - 1];

  // Arrow function conversion
  if (!lastLine?.includes('}')) {
    return str.replace('=> ', '{ return ') + '; }';
  }

  // Cleanup arrow function
  if (firstLine.includes('=>')) {
    return str.replace('=> ', '');
  }

  return str;
}

export function assetHash(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

/**
 * Island defaults
 */
export const ISLAND_DEFAULTS: () => HS.ClientIslandOptions = () => ({
  ssr: true,
  loading: undefined,
});

export function renderIsland(Component: any, props: any, options = ISLAND_DEFAULTS()) {
  // Render island with its own logic
  if (Component.__HS_ISLAND?.render) {
    return html.raw(Component.__HS_ISLAND.render(props, options));
  }

  throw new Error(
    `Module ${Component.name} was not loaded with an island plugin! Did you forget to install an island plugin and add it to the 'islandPlugins' option in your hyperspan.config.ts file?`
  );
}