import { readFileSync, existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { html } from '@hyperspan/html';
import { assetHash as assetHashFn } from '../utils';
import { getImportMap, registerImport, resolveImport } from './manifest';
import type { Hyperspan as HS } from '../types';

export { registerImport, resolveImport, getImportMap } from './manifest';

export const JS_PUBLIC_PATH = '/_hs/js';
export const JS_ISLAND_PUBLIC_PATH = '/_hs/js/islands';

export type ClientJSType = 'module' | 'iife';

export type BuildClientJSOptions = {
  /** `iife` emits a classic <script> (runs during HTML streaming). Default `module`. */
  type?: ClientJSType;
};

export type ClientJSEntry = {
  absPath: string;
  assetHash: string;
  esmName: string;
  publicPath: string;
  exports: string;
  fnArgs: string;
  type: ClientJSType;
};

const CLIENT_JS_REGISTRY = Symbol.for('@hyperspan/client-js-entries');

function getClientJSRegistry(): Map<string, ClientJSEntry> {
  const globalRegistry = globalThis as {
    [CLIENT_JS_REGISTRY]?: Map<string, ClientJSEntry>;
  };
  if (!globalRegistry[CLIENT_JS_REGISTRY]) {
    globalRegistry[CLIENT_JS_REGISTRY] = new Map();
  }
  return globalRegistry[CLIENT_JS_REGISTRY];
}

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

/**
 * Resolve import.meta.resolve() / file URL / absolute path to a filesystem path.
 */
export function resolveClientModulePath(modulePathResolved: string): string {
  if (modulePathResolved.startsWith('file://')) {
    return fileURLToPath(modulePathResolved);
  }
  return modulePathResolved;
}

/**
 * Resolve a client module path for hashing and bundling.
 * Logical app-relative paths (e.g. app/client/foo.ts) hash consistently across
 * Node and edge runtimes where absolute paths differ.
 */
export function resolveClientModulePaths(modulePathResolved: string): {
  hashKey: string;
  absPath: string;
} {
  const resolved = resolveClientModulePath(modulePathResolved).replace(/\\/g, '/');

  if (!isAbsolute(resolved)) {
    const hashKey = resolved;
    if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
      const candidate = join(process.cwd(), hashKey);
      if (existsSync(candidate)) {
        return { hashKey, absPath: candidate };
      }
    }
    try {
      const url = import.meta.resolve(resolved);
      if (typeof url === 'string' && url.startsWith('file://')) {
        return { hashKey, absPath: fileURLToPath(url) };
      }
    } catch {
      // Bare specifiers that aren't installed yet still hash stably.
    }
    return { hashKey, absPath: hashKey };
  }

  return { hashKey: resolved, absPath: resolved };
}

export function getClientJSEntries(): ClientJSEntry[] {
  return [...getClientJSRegistry().values()];
}

export function getClientJSEntryByEsmName(esmName: string): ClientJSEntry | undefined {
  return getClientJSRegistry().get(esmName);
}

export function resetClientJSEntriesForTests(): void {
  getClientJSRegistry().clear();
}

function registerClientJSEntry(entry: ClientJSEntry): void {
  getClientJSRegistry().set(entry.esmName, entry);
}

function registerClientJS(
  modulePathResolved: string,
  options: BuildClientJSOptions = {}
): HS.ClientJSBuildResult {
  const type = options.type ?? 'module';
  const { hashKey, absPath } = resolveClientModulePaths(modulePathResolved);
  const hash = assetHashFn(hashKey);
  const esmName = `client-${hash}`;
  const publicPath = resolveImport(esmName) ?? `${JS_PUBLIC_PATH}/${esmName}.js`;

  let exports = '* as _module';
  let fnArgs = '_module';
  const sourcePath = existsSync(absPath) ? absPath : null;
  if (sourcePath) {
    const source = readFileSync(sourcePath, 'utf-8');
    const discovered = discoverClientExports(source);
    exports = discovered.exports;
    fnArgs = discovered.fnArgs;
  }

  registerClientJSEntry({ absPath, assetHash: hash, esmName, publicPath, exports, fnArgs, type });
  registerImport(esmName, publicPath);

  return {
    assetHash: hash,
    esmName,
    publicPath,
    renderScriptTag: (loadScript) => {
      if (type === 'iife') {
        return html`<script src="${publicPath}"></script>`;
      }

      const t = typeof loadScript;

      if (t === 'string') {
        return html`
          <script type="module" data-source-id="${hash}">
            import ${exports} from '${esmName}';
            (${html.raw(loadScript as string)})(${fnArgs});
          </script>
        `;
      }
      if (t === 'function') {
        return html`
          <script type="module" data-source-id="${hash}">
            import ${exports} from '${esmName}';
            (${html.raw(functionToString(loadScript))})(${fnArgs});
          </script>
        `;
      }

      return html`
        <script type="module" data-source-id="${hash}">
          import '${esmName}';
        </script>
      `;
    },
  };
}

/**
 * Build (or look up) a client JS module and return a helper for rendering script tags.
 *
 * Never evaluates the module on the server — only registers the path for Vite to bundle
 * and returns URLs / script-tag helpers for the browser.
 */
export async function buildClientJS(
  modulePathResolved: string,
  options: BuildClientJSOptions = {}
): Promise<HS.ClientJSBuildResult> {
  return registerClientJS(modulePathResolved, options);
}

/** Same `buildClientJS` path an app would use for a package export. */
export const streamingClient = registerClientJS(
  '@hyperspan/framework/client/_hs/hyperspan-streaming.client.ts',
  { type: 'iife' }
);
export const actionsClient = registerClientJS(
  '@hyperspan/framework/client/_hs/hyperspan-actions.client.ts'
);

/**
 * Discover export names from source or bundled client JS.
 * Prefers bundled `export{...}` form, then common source export patterns.
 */
export function discoverClientExports(contents: string): { exports: string; fnArgs: string } {
  const bundled = extractExports(contents);
  if (bundled.exports !== '* as _module') {
    return bundled;
  }

  const names: string[] = [];
  const seen = new Set<string>();

  for (const re of [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /export\s+const\s+([A-Za-z_$][\w$]*)/g,
    /export\s+class\s+([A-Za-z_$][\w$]*)/g,
    /export\s+let\s+([A-Za-z_$][\w$]*)/g,
  ]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(contents)) !== null) {
      if (!seen.has(match[1])) {
        names.push(match[1]);
        seen.add(match[1]);
      }
    }
  }

  const exportBlock = /export\s*\{([^}]+)\}/g;
  let block: RegExpExecArray | null;
  while ((block = exportBlock.exec(contents)) !== null) {
    for (const part of block[1].split(',')) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith('type ')) continue;
      const asMatch = trimmed.match(/^(?:([\w$]+)\s+as\s+)?([\w$]+)$/);
      const name = asMatch?.[2] ?? trimmed;
      if (name && name !== 'default' && !seen.has(name)) {
        names.push(name);
        seen.add(name);
      }
    }
  }

  if (names.length === 0) {
    if (/export\s+default\b/.test(contents)) {
      return { exports: 'DefaultExport', fnArgs: 'DefaultExport' };
    }
    return { exports: '* as _module', fnArgs: '_module' };
  }

  const exports = `{${names.join(', ')}}`;
  return { exports, fnArgs: exports };
}

/**
 * Extract the exports from a client JS module (bundled `export{a as b}` form).
 */
export function extractExports(contents: string): { exports: string; fnArgs: string } {
  const exportRegex = /export\{(.*)\}/g;
  const exportLine = exportRegex.exec(contents);
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
