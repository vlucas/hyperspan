import { readFileSync, existsSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { html } from '@hyperspan/html';
import { assetHash as assetHashFn } from '../utils';
import { getAssetManifest, getImportMap, registerImport, resolveImport } from './manifest';
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
  /** Original path/specifier passed to `buildClientJS`. */
  modulePath: string;
  absPath: string;
  /** Identities used to look up a stable import-map key when the source file is gone (Workers). */
  sourceKeys: string[];
  /** Identity hash of the resolved path (not file contents). */
  assetHash: string;
  esmName: string;
  publicPath: string;
  exports: string;
  fnArgs: string;
  type: ClientJSType;
};

const CLIENT_JS_REGISTRY = Symbol.for('@hyperspan/client-js-entries');
const PATH_ALIASES = Symbol.for('@hyperspan/path-aliases');

function getPathAliases(): Record<string, string> {
  const globalAliases = globalThis as {
    [PATH_ALIASES]?: Record<string, string>;
  };
  if (!globalAliases[PATH_ALIASES]) {
    globalAliases[PATH_ALIASES] = {};
  }
  return globalAliases[PATH_ALIASES];
}

/** Register tsconfig path aliases (`~/` → project root). Called by the Vite plugin. */
export function registerPathAliases(aliases: Record<string, string>): void {
  Object.assign(getPathAliases(), aliases);
}

function resolveWithAliases(specifier: string): string | undefined {
  const aliases = getPathAliases();
  const keys = Object.keys(aliases).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (specifier === key || specifier.startsWith(key)) {
      const rest = specifier.slice(key.length).replace(/^\//, '');
      return join(aliases[key], rest);
    }
  }
  return undefined;
}

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
 * File URLs from `import.meta.resolve` must not use a cwd-relative pnpm path —
 * that changes between install layouts and Workers. Prefer the path after the
 * last `node_modules/` so published packages stay stable.
 */
export function stableClientSourceKey(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/');
  const marker = '/node_modules/';
  const idx = normalized.lastIndexOf(marker);
  if (idx !== -1) {
    return normalized.slice(idx + marker.length);
  }
  if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
    const rel = relative(process.cwd(), absPath).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      return rel;
    }
  }
  return normalized;
}

function toFilePath(modulePath: string): string {
  return modulePath.startsWith('file://') ? fileURLToPath(modulePath) : modulePath;
}

function tryResolveToFile(specifier: string): string | undefined {
  try {
    if (typeof import.meta.resolve !== 'function') {
      return undefined;
    }
    const resolved = import.meta.resolve(specifier);
    if (typeof resolved === 'string' && (resolved.startsWith('file://') || isAbsolute(resolved))) {
      return toFilePath(resolved);
    }
  } catch {
    // Workers and unresolved package specifiers — Vite already emitted the asset.
  }
  return undefined;
}

function clientPublicPath(esmName: string): string {
  return resolveImport(esmName) ?? `${JS_PUBLIC_PATH}/${esmName}.js`;
}

/**
 * Resolve to a real file path. The import-map key hashes `stableClientSourceKey(absPath)`
 * so `import.meta.resolve()`, aliases, and package specifiers of the same file share
 * one key. Vite/esbuild attach a content hash to the emitted filename; `publicPath`
 * reads that from the asset manifest. Relative `./` / `../` paths error — resolve
 * them at the call site.
 */
function resolveClientAbsPath(modulePath: string): string {
  if (modulePath.startsWith('file://') || isAbsolute(modulePath)) {
    return toFilePath(modulePath);
  }

  const specifier = modulePath.replace(/\\/g, '/');
  if (specifier.startsWith('.')) {
    throw new Error(
      `[Hyperspan] buildClientJS(${JSON.stringify(modulePath)}) got a relative path. ` +
        `Use import.meta.resolve(${JSON.stringify(modulePath)}) at the call site, ` +
        `or a tsconfig alias like '~/app/client/file.ts'.`
    );
  }

  const aliased = resolveWithAliases(specifier);
  if (aliased) {
    return aliased;
  }

  return tryResolveToFile(specifier) ?? join(process.cwd(), specifier);
}

function readClientSource(absPath: string): string | undefined {
  try {
    if (existsSync(absPath)) {
      return readFileSync(absPath, 'utf-8');
    }
  } catch {
    // Workers have no filesystem; Vite already bundled from this entry.
  }
  return undefined;
}

function clientSourceKeys(modulePath: string, absPath: string): string[] {
  const keys = new Set<string>([stableClientSourceKey(absPath), modulePath.replace(/\\/g, '/')]);
  if (modulePath.startsWith('file://')) {
    keys.add(toFilePath(modulePath));
  }
  return [...keys];
}

function resolveEsmName(sourceKeys: string[], fallbackHash: string): string {
  const sources = getAssetManifest().clientSources;
  if (sources) {
    for (const key of sourceKeys) {
      if (sources[key]) {
        return sources[key];
      }
    }
  }
  return `client-${fallbackHash}`;
}

export function getClientJSEntries(): ClientJSEntry[] {
  return [...getClientJSRegistry().values()];
}

export function getClientJSEntryByEsmName(esmName: string): ClientJSEntry | undefined {
  for (const entry of getClientJSRegistry().values()) {
    if (currentEsmName(entry) === esmName) {
      return entry;
    }
  }
  return undefined;
}

export function getClientJSSourceMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of getClientJSEntries()) {
    const esmName = currentEsmName(entry);
    for (const key of entry.sourceKeys) {
      map[key] = esmName;
    }
  }
  return map;
}

export function resetClientJSEntriesForTests(): void {
  getClientJSRegistry().clear();
  const aliases = getPathAliases();
  for (const key of Object.keys(aliases)) {
    delete aliases[key];
  }
}

function currentEsmName(entry: ClientJSEntry): string {
  return resolveEsmName(entry.sourceKeys, entry.assetHash);
}

function registerClientJS(
  modulePathResolved: string,
  options: BuildClientJSOptions = {}
): HS.ClientJSBuildResult {
  const type = options.type ?? 'module';
  const absPath = resolveClientAbsPath(modulePathResolved);
  const sourceKeys = clientSourceKeys(modulePathResolved, absPath);
  const identityKey = stableClientSourceKey(absPath);
  const hash = assetHashFn(identityKey);
  const source = readClientSource(absPath);

  let exports = '* as _module';
  let fnArgs = '_module';
  if (source) {
    const discovered = discoverClientExports(source);
    exports = discovered.exports;
    fnArgs = discovered.fnArgs;
  }

  const entry: ClientJSEntry = {
    modulePath: modulePathResolved,
    absPath,
    sourceKeys,
    assetHash: hash,
    get esmName() {
      return currentEsmName(entry);
    },
    get publicPath() {
      return clientPublicPath(currentEsmName(entry));
    },
    exports,
    fnArgs,
    type,
  };
  getClientJSRegistry().set(identityKey, entry);
  registerImport(entry.esmName, entry.publicPath);

  return {
    get assetHash() {
      return currentEsmName(entry).replace(/^client-/, '');
    },
    get esmName() {
      return currentEsmName(entry);
    },
    get publicPath() {
      return clientPublicPath(currentEsmName(entry));
    },
    renderScriptTag: (loadScript) => {
      const esmName = currentEsmName(entry);
      const tagHash = esmName.replace(/^client-/, '');
      if (type === 'iife') {
        return html`<script src="${clientPublicPath(esmName)}"></script>`;
      }

      const t = typeof loadScript;

      if (t === 'string') {
        return html`
          <script type="module" data-source-id="${tagHash}">
            import ${exports} from '${esmName}';
            (${html.raw(loadScript as string)})(${fnArgs});
          </script>
        `;
      }
      if (t === 'function') {
        return html`
          <script type="module" data-source-id="${tagHash}">
            import ${exports} from '${esmName}';
            (${html.raw(functionToString(loadScript))})(${fnArgs});
          </script>
        `;
      }

      return html`
        <script type="module" data-source-id="${tagHash}">
          import '${esmName}';
        </script>
      `;
    },
  };
}

/**
 * Register a client JS module for Vite to bundle.
 * Prefer `import.meta.resolve('./file.ts')`, a tsconfig alias, or a project-root path.
 * The import-map key is a stable identity of the resolved file. Vite/esbuild content-hash
 * the emitted filename; `publicPath` uses that URL from the asset manifest when present.
 */
export async function buildClientJS(
  modulePathResolved: string,
  options: BuildClientJSOptions = {}
): Promise<HS.ClientJSBuildResult> {
  return registerClientJS(modulePathResolved, options);
}

export const streamingClient = registerClientJS(
  import.meta.resolve('./_hs/hyperspan-streaming.client.ts'),
  { type: 'iife' }
);
export const actionsClient = registerClientJS(
  import.meta.resolve('./_hs/hyperspan-actions.client.ts')
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
