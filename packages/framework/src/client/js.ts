import { readFileSync, existsSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { html } from '../html';
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
  /** Original path/specifier passed to `buildClientJS`. */
  modulePath: string;
  /** Resolved file path. Lazy — only a build/dev tool with a filesystem reads this. */
  absPath: string;
  /** Runtime-stable identity of the module. Same value on Vite, Node, and Workers. */
  identityKey: string;
  /**
   * Identity came from a filesystem path rather than a logical specifier. Such an
   * identity only matches at runtime on a runtime that can resolve paths, so it is
   * not portable to a Worker.
   */
  identityFromPath: boolean;
  /** Identity hash of `identityKey` (not of file contents). */
  assetHash: string;
  esmName: string;
  publicPath: string;
  exports: string;
  fnArgs: string;
  type: ClientJSType;
};

export type ClientJSPathIdentity = {
  modulePath: string;
  identityKey: string;
};

const CLIENT_JS_REGISTRY = Symbol.for('@hyperspan/client-js-entries');
const CLIENT_JS_PATH_IDENTITIES = Symbol.for('@hyperspan/client-js-path-identities');
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

/**
 * Client scripts registered from a path rather than a logical specifier, kept outside
 * the registry. A path identity can coincide with the equivalent project-relative
 * specifier (`file:///proj/app/client/x.ts` and `app/client/x.ts` share one identity),
 * so the registry entry may be replaced by whichever form registered last. Deploy
 * checks need the record regardless of that order.
 */
export function getPathIdentityClientJS(): ClientJSPathIdentity[] {
  const globalPathIdentities = globalThis as {
    [CLIENT_JS_PATH_IDENTITIES]?: ClientJSPathIdentity[];
  };
  if (!globalPathIdentities[CLIENT_JS_PATH_IDENTITIES]) {
    globalPathIdentities[CLIENT_JS_PATH_IDENTITIES] = [];
  }
  return globalPathIdentities[CLIENT_JS_PATH_IDENTITIES];
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
 * File paths must not become a cwd-relative pnpm path — that changes between
 * install layouts and Workers. Prefer the path after the last `node_modules/`
 * so published packages stay stable.
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
 * Identity of a client module, computed with string math only — no filesystem and
 * no `import.meta.resolve`. Workers can therefore build the same identity (and so
 * the same public URL) that Vite used at build time.
 *
 * A logical specifier (package export, tsconfig alias, project-root path) is its
 * own identity. File URLs and absolute paths fall back to a path identity.
 */
function clientIdentityKey(specifier: string): string {
  if (specifier.startsWith('file://') || isAbsolute(specifier)) {
    return stableClientSourceKey(toFilePath(specifier));
  }
  return specifier;
}

/**
 * Resolve an identity to a real file path. Only build/dev tooling calls this, so
 * `import.meta.resolve` never runs during module load on a Worker.
 */
function resolveClientAbsPath(specifier: string): string {
  if (specifier.startsWith('file://') || isAbsolute(specifier)) {
    return toFilePath(specifier);
  }

  const aliased = resolveWithAliases(specifier);
  if (aliased) {
    return aliased;
  }

  const cwd =
    typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '';
  return tryResolveToFile(specifier) ?? (cwd ? join(cwd, specifier) : specifier);
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

export function getClientJSEntries(): ClientJSEntry[] {
  return [...getClientJSRegistry().values()];
}

export function getClientJSEntryByEsmName(esmName: string): ClientJSEntry | undefined {
  return getClientJSRegistry().get(esmName);
}

export function resetClientJSEntriesForTests(): void {
  getClientJSRegistry().clear();
  getPathIdentityClientJS().length = 0;
  const aliases = getPathAliases();
  for (const key of Object.keys(aliases)) {
    delete aliases[key];
  }
}

function registerClientJS(
  modulePathResolved: string,
  options: BuildClientJSOptions = {}
): HS.ClientJSBuildResult {
  const type = options.type ?? 'module';
  const specifier = modulePathResolved.replace(/\\/g, '/');
  if (specifier.startsWith('.')) {
    throw new Error(
      `[Hyperspan] buildClientJS(${JSON.stringify(modulePathResolved)}) got a relative path, ` +
        `which has no stable identity across dev, build, and deploy. Use a tsconfig alias ` +
        `like '~/app/client/file.ts' — the build resolves it, and every runtime (including ` +
        `Workers, which cannot resolve paths) matches it in the asset manifest.`
    );
  }

  const identityKey = clientIdentityKey(specifier);
  const identityFromPath = identityKey !== specifier;
  const hash = assetHashFn(identityKey);
  const esmName = `client-${hash}`;

  if (identityFromPath) {
    getPathIdentityClientJS().push({ modulePath: modulePathResolved, identityKey });
  }

  let absPath: string | undefined;
  let discovered: { exports: string; fnArgs: string } | undefined;

  // Both are lazy: a Worker renders script tags without a filesystem, and
  // resolving there would need `import.meta.resolve`, which workerd may reject.
  function currentAbsPath(): string {
    return (absPath ??= resolveClientAbsPath(specifier));
  }
  function currentExports(): { exports: string; fnArgs: string } {
    if (!discovered) {
      const source = readClientSource(currentAbsPath());
      discovered = source
        ? discoverClientExports(source)
        : { exports: '* as _module', fnArgs: '_module' };
    }
    return discovered;
  }

  const entry: ClientJSEntry = {
    modulePath: modulePathResolved,
    get absPath() {
      return currentAbsPath();
    },
    identityKey,
    identityFromPath,
    assetHash: hash,
    esmName,
    get publicPath() {
      return clientPublicPath(esmName);
    },
    get exports() {
      return currentExports().exports;
    },
    get fnArgs() {
      return currentExports().fnArgs;
    },
    type,
  };
  getClientJSRegistry().set(esmName, entry);
  registerImport(esmName, entry.publicPath);

  return {
    assetHash: hash,
    esmName,
    get publicPath() {
      return clientPublicPath(esmName);
    },
    renderScriptTag: (loadScript) => {
      if (type === 'iife') {
        return html`<script src="${clientPublicPath(esmName)}"></script>`;
      }

      const t = typeof loadScript;
      const { exports, fnArgs } = currentExports();

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
 * Register a client JS module for Vite to bundle.
 * Prefer a package export, tsconfig alias, or project-root path
 * (`@scope/pkg/file.ts`, `~/app/client/foo.ts`, `app/client/foo.ts`) — those need no
 * filesystem lookup, so Vite, Node, and Workers all derive the same public URL.
 * Vite/esbuild content-hash the emitted filename; `publicPath` reads that URL from
 * the asset manifest. Relative `./` / `../` paths must be resolved at the call site
 * with `import.meta.resolve('./file.ts')`.
 */
export async function buildClientJS(
  modulePathResolved: string,
  options: BuildClientJSOptions = {}
): Promise<HS.ClientJSBuildResult> {
  return registerClientJS(modulePathResolved, options);
}

// Registered through the same public API an app uses. Package-export specifiers keep
// module load free of `import.meta.resolve`, which workerd rejects after bundling.
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
