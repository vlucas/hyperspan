import { html } from '@hyperspan/html';
import { assetHash as assetHashFn } from '../utils';
import { join } from 'node:path';
import type { Hyperspan as HS } from '../types';

const CWD = process.cwd();
const IS_PROD = process.env.NODE_ENV === 'production';

export const JS_PUBLIC_PATH = '/_hs/js';
export const JS_ISLAND_PUBLIC_PATH = '/_hs/js/islands';
export const JS_IMPORT_MAP = new Map<string, string>();
const CLIENT_JS_CACHE = new Map<string, { esmName: string, exports: string, fnArgs: string, publicPath: string }>();
const CLIENT_JS_BUILD_PROMISES = new Map<string, Promise<void>>();
const EXPORT_REGEX = /export\{(.*)\}/g;

/**
 * Build a client JS module and return a Hyperspan.ClientJSBuildResult object
 */
export async function buildClientJS(modulePathResolved: string): Promise<HS.ClientJSBuildResult> {
  const modulePath = modulePathResolved.replace('file://', '');
  const assetHash = assetHashFn(modulePath);

  // Cache: Avoid re-processing the same file
  if (!CLIENT_JS_CACHE.has(assetHash)) {
    const existingBuild = CLIENT_JS_BUILD_PROMISES.get(assetHash);
    // Await the existing build promise if it exists (this can get called in parallel from Bun traversing imports)
    if (existingBuild) {
      await existingBuild;
    } else {
      const buildPromise = (async () => {
        // Build the client JS module
        const result = await Bun.build({
          entrypoints: [modulePath],
          outdir: join(CWD, './public', JS_PUBLIC_PATH), // @TODO: Make this configurable... should be read from config file...
          naming: IS_PROD ? '[dir]/[name]-[hash].[ext]' : undefined,
          external: Array.from(JS_IMPORT_MAP.keys()),
          minify: true,
          format: 'esm',
          target: 'browser',
          env: 'APP_PUBLIC_*',
        });

        // Add output file to import map
        const esmName = String(result.outputs[0].path.split('/').reverse()[0]).replace('.js', '');
        const publicPath = `${JS_PUBLIC_PATH}/${esmName}.js`;
        JS_IMPORT_MAP.set(esmName, publicPath);

        // Get the contents of the file to extract the exports
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

        CLIENT_JS_CACHE.set(assetHash, { esmName, exports, fnArgs, publicPath });
      })();

      CLIENT_JS_BUILD_PROMISES.set(assetHash, buildPromise);
      try {
        await buildPromise;
      } finally {
        CLIENT_JS_BUILD_PROMISES.delete(assetHash);
      }
    }
  }

  const { esmName, exports, fnArgs, publicPath } = CLIENT_JS_CACHE.get(assetHash)!;

  return {
    assetHash,
    esmName,
    publicPath,
    renderScriptTag: (loadScript) => {
      const t = typeof loadScript;

      if (t === 'string') {
        return html`
          <script type="module" data-source-id="${assetHash}">import ${exports} from "${esmName}";\n(${html.raw(loadScript as string)})(${fnArgs});</script>
        `;
      }
      if (t === 'function') {
        return html`
          <script type="module" data-source-id="${assetHash}">import ${exports} from "${esmName}";\n(${html.raw(functionToString(loadScript))})(${fnArgs});</script>
        `;
      }

      return html`
        <script type="module" data-source-id="${assetHash}">import "${esmName}";</script>
      `;
    }
  }
}

/**
 * Convert a function to a string (results in loss of context!)
 * Handles named, async, and arrow functions
 */
export function functionToString(fn: any) {
  return fn.toString().trim();
}