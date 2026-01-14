import { HSHtml, html } from '@hyperspan/html';
import { assetHash } from '../utils';
import { join } from 'node:path';

const CWD = process.cwd();
const IS_PROD = process.env.NODE_ENV === 'production';

export const JS_PUBLIC_PATH = '/_hs/js';
export const JS_ISLAND_PUBLIC_PATH = '/_hs/js/islands';
export const JS_IMPORT_MAP = new Map<string, string>();
const CLIENT_JS_CACHE = new Map<string, { esmName: string, exports: string, fnArgs: string, publicPath: string }>();
const EXPORT_REGEX = /export\{(.*)\}/g;

type ClientJSModuleReturn = {
  esmName: string;
  jsId: string;
  publicPath: string;
  renderScriptTag: (loadScript?: ((module: unknown) => HSHtml | string) | string) => HSHtml;
}

/**
 * Load a client JS module
 */
export async function loadClientJS(modulePathResolved: string): Promise<ClientJSModuleReturn> {
  const modulePath = modulePathResolved.replace('file://', '');
  const jsId = assetHash(modulePath);

  // Cache: Avoid re-processing the same file
  if (!CLIENT_JS_CACHE.has(jsId)) {

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
    CLIENT_JS_CACHE.set(jsId, { esmName, exports, fnArgs, publicPath });
  }

  const { esmName, exports, fnArgs, publicPath } = CLIENT_JS_CACHE.get(jsId)!;

  return {
    esmName,
    jsId,
    publicPath,
    renderScriptTag: (loadScript) => {
      const t = typeof loadScript;

      if (t === 'string') {
        return html`
          <script type="module" data-source-id="${jsId}">import ${exports} from "${esmName}";\n(${html.raw(loadScript as string)})(${fnArgs});</script>
        `;
      }
      if (t === 'function') {
        return html`
          <script type="module" data-source-id="${jsId}">import ${exports} from "${esmName}";\n(${html.raw(functionToString(loadScript))})(${fnArgs});</script>
        `;
      }

      return html`
        <script type="module" data-source-id="${jsId}">import "${esmName}";</script>
      `;
    }
  }
}

/**
 * Convert a function to a string (results in loss of context!)
 * Handles named, async, and arrow functions
 */
export function functionToString(fn: any) {
  let str = fn.toString().trim();

  return str;
}