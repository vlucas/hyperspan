import { html } from '@hyperspan/html';
import { getImportMap, registerImport, resolveImport } from './manifest';
import type { Hyperspan as HS } from '../types';

export { registerImport, resolveImport, getImportMap } from './manifest';

export const JS_PUBLIC_PATH = '/_hs/js';
export const JS_ISLAND_PUBLIC_PATH = '/_hs/js/islands';

/**
 * Backward-compatible import map (backed by asset manifest).
 */
export const JS_IMPORT_MAP = {
  get size() {
    return Object.keys(getImportMap()).length;
  },
  keys() {
    return Object.keys(getImportMap()).values();
  },
  has(key: string) {
    return resolveImport(key) !== undefined;
  },
  get(key: string) {
    return resolveImport(key);
  },
  set(key: string, value: string) {
    registerImport(key, value);
    return this;
  },
  entries() {
    return Object.entries(getImportMap()).values();
  },
  [Symbol.iterator]() {
    return Object.entries(getImportMap())[Symbol.iterator]();
  },
};

const EXPORT_REGEX = /export\{(.*)\}/g;

/**
 * @deprecated Use build-time asset manifest via @hyperspan/vite-plugin instead.
 * Kept for compatibility — returns manifest entry if available.
 */
export async function buildClientJS(_modulePathResolved: string): Promise<HS.ClientJSBuildResult> {
  const { getClientJSFromManifest } = await import('./manifest');
  const moduleId = _modulePathResolved.includes('streaming')
    ? 'streaming'
    : _modulePathResolved.includes('actions')
      ? 'actions'
      : 'scripts';

  try {
    return getClientJSFromManifest(moduleId);
  } catch {
    const esmName = moduleId;
    const publicPath = `${JS_PUBLIC_PATH}/hyperspan-${moduleId}.client.js`;
    registerImport(esmName, publicPath);
    return {
      assetHash: moduleId,
      esmName,
      publicPath,
      renderScriptTag: () => html`<script type="module" src="${publicPath}"></script>`,
    };
  }
}

/**
 * Extract the exports from a client JS module
 */
export function extractExports(contents: string): { exports: string; fnArgs: string } {
  const exportLine = EXPORT_REGEX.exec(contents);
  let exports = '{}';
  let fnArgs = '{}';

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

  fnArgs = exports.replace(/(\w+)\s*as\s*(\w+)/g, '$1: $2').trim();

  if (exports === '{}' && fnArgs === '{}') {
    exports = '* as _module';
    fnArgs = '_module';
  }

  return { exports, fnArgs };
}

/**
 * Convert a function to a string (results in loss of context!)
 */
export function functionToString(fn: unknown) {
  return (fn as (...args: unknown[]) => unknown).toString().trim();
}
