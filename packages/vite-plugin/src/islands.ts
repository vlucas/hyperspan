import { dirname, join, relative } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import fg from 'fast-glob';
import type { Plugin } from 'vite';
import { registerImport } from '@hyperspan/framework';
import { JS_ISLAND_PUBLIC_PATH } from '@hyperspan/framework/client/js';
import { assetHash } from '@hyperspan/framework/utils';
import { resolveAliasedSpecifier, resolveModuleAliases } from './tsconfig-aliases';

export type IslandFramework = string;

export type IslandExportKind = 'default' | 'named';

export type IslandPluginRegistration = {
  framework: string;
  ext: string;
  specifiers: readonly string[];
  vitePlugin: () => Plugin;
};

export function buildIslandHtml(
  jsId: string,
  componentName: string,
  esmName: string,
  jsContent: string,
  ssrContent: string,
  options: { loading?: string; exportKind?: IslandExportKind } = {}
): string {
  const importStmt =
    options.exportKind === 'named'
      ? `import { ${componentName} } from "${esmName}";`
      : `import ${componentName} from "${esmName}";`;
  const scriptTag = `<script type="module" id="${jsId}_script" data-source-id="${jsId}">${importStmt}${jsContent}</script>`;
  if (options.loading === 'lazy') {
    return `<div id="${jsId}">${ssrContent}</div><div data-loading="lazy" style="height:1px;width:1px;overflow:hidden;"><template>\n${scriptTag}</template></div>`;
  }
  return `<div id="${jsId}">${ssrContent}</div>\n${scriptTag}`;
}

/** Inlinable JS source for island SSR transforms — embed via `${buildIslandHtmlSource}`. */
export const buildIslandHtmlSource = `function __hs_buildIslandHtml(jsId, componentName, esmName, jsContent, ssrContent, options) {
  options = options || {};
  const importStmt = options.exportKind === 'named'
    ? 'import { ' + componentName + ' } from "' + esmName + '";'
    : 'import ' + componentName + ' from "' + esmName + '";';
  const scriptTag = \`<script type="module" id="\${jsId}_script" data-source-id="\${jsId}">\${importStmt}\${jsContent}</script>\`;
  if (options.loading === 'lazy') {
    return \`<div id="\${jsId}">\${ssrContent}</div><div data-loading="lazy" style="height:1px;width:1px;overflow:hidden;"><template>\\n\${scriptTag}</template></div>\`;
  }
  return \`<div id="\${jsId}">\${ssrContent}</div>\\n\${scriptTag}\`;
}`;

const ISLAND_PLUGINS_KEY = Symbol.for('@hyperspan/island-plugins');

function getIslandPluginRegistry(): Map<string, IslandPluginRegistration> {
  const globalStore = globalThis as typeof globalThis & {
    [ISLAND_PLUGINS_KEY]?: Map<string, IslandPluginRegistration>;
  };
  if (!globalStore[ISLAND_PLUGINS_KEY]) {
    globalStore[ISLAND_PLUGINS_KEY] = new Map();
  }
  return globalStore[ISLAND_PLUGINS_KEY];
}

export function registerIslandPlugin(registration: IslandPluginRegistration): void {
  getIslandPluginRegistry().set(registration.framework, registration);
}

export function getIslandPluginRegistration(
  framework: string
): IslandPluginRegistration | undefined {
  return getIslandPluginRegistry().get(framework);
}

export function isIslandPluginLoaded(framework: string): boolean {
  return getIslandPluginRegistry().has(framework);
}

export function resetIslandPluginsForTests(): void {
  getIslandPluginRegistry().clear();
}

export function getRegisteredIslandFrameworks(): string[] {
  return [...getIslandPluginRegistry().keys()];
}

/** Vite plugins for frameworks registered via hyperspan.config.ts. */
export function resolveRegisteredIslandVitePlugins(): Plugin[] {
  return [...getIslandPluginRegistry().values()].map((entry) => entry.vitePlugin());
}

export function splitIslandId(id: string): { path: string; query: URLSearchParams } {
  const q = id.indexOf('?');
  if (q === -1) {
    return { path: id, query: new URLSearchParams() };
  }
  return { path: id.slice(0, q), query: new URLSearchParams(id.slice(q + 1)) };
}

export function getIslandFramework(
  source: string,
  attributes?: Record<string, string>
): string | null {
  const attr = attributes?.island;
  if (attr) return attr;

  const { query } = splitIslandId(source);
  return query.get('island');
}

export function assertIslandPluginLoaded(framework: string, source: string): void {
  if (!framework) return;
  const registration = getIslandPluginRegistry().get(framework);
  if (registration) return;

  throw new Error(
    `Island import "${source}" uses with { island: '${framework}' }, but the matching island plugin is not loaded. ` +
      `Add the ${framework} island plugin to plugins in hyperspan.config.ts.`
  );
}

export function isIslandModule(id: string, framework: string, ext: string): boolean {
  if (id.includes('node_modules')) return false;
  const { path, query } = splitIslandId(id);
  if (!path.endsWith(ext)) return false;
  return query.get('island') === framework;
}

/**
 * Client island modules must import their UI runtime as a bare specifier so the
 * page import map (and the inline hydrate script) share one copy. Bundling
 * Preact/Vue/Svelte into the island chunk makes hooks/hydrate no-ops.
 */
export function externalClientIslandRuntime(
  id: string,
  importer: string | undefined,
  options: { ssr?: boolean } | undefined,
  framework: string,
  ext: string,
  isRuntimeSpecifier: (specifier: string) => boolean
): { id: string; external: true } | undefined {
  if (options?.ssr || !importer) return undefined;
  if (!isIslandModule(importer, framework, ext)) return undefined;
  if (!isRuntimeSpecifier(id)) return undefined;
  return { id, external: true };
}

export function isRuntimeSpecifier(id: string, names: readonly string[]): boolean {
  return names.some((name) => id === name || id.startsWith(`${name}/`));
}

export function isSsrTransform(
  pluginContext: { environment?: { name?: string } },
  options?: { ssr?: boolean }
): boolean {
  if (typeof options?.ssr === 'boolean') return options.ssr;
  return pluginContext.environment?.name === 'ssr';
}

/** Rewrite `from './x' with { island: 'preact' }` so Vite SSR can resolve the island. */
export function rewriteIslandImportQueries(code: string): string | null {
  const re = /\bfrom\s+(['"])([^'"]+)\1(\s+with\s*\{\s*island\s*:\s*)(['"])([^'"]+)\4/g;
  let changed = false;
  const next = code.replace(re, (full, quote, spec, mid, frameworkQuote, framework) => {
    if (String(spec).includes('island=')) return full;
    changed = true;
    return `from ${quote}${spec}?island=${framework}${quote}${mid}${frameworkQuote}${framework}${frameworkQuote}`;
  });
  return changed ? next : null;
}

export function islandImportQueryPlugin(): Plugin {
  return {
    name: 'hyperspan-island-import-query',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('node_modules')) return;
      if (!code.includes('island') || !code.includes('with')) return;
      const next = rewriteIslandImportQueries(code);
      if (next == null) return;
      return { code: next, map: null };
    },
  };
}

/** Scan the app for `with { island }` imports so the client build emits those modules. */
export function discoverIslandClientEntries(root: string): Record<string, string> {
  const aliases = resolveModuleAliases(root);
  const files = fg.sync('**/*.{ts,tsx,js,jsx}', {
    cwd: root,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**'],
  });
  const re = /\bfrom\s+(['"])([^'"]+)\1\s+with\s*\{\s*island\s*:\s*(['"])([^'"]+)\3/g;
  const entries: Record<string, string> = {};

  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    if (!code.includes('island') || !code.includes('with')) continue;
    for (const match of code.matchAll(re)) {
      const spec = String(match[2]).replace(/\?island=[^'"]+$/, '');
      const framework = match[4];
      const aliased = resolveAliasedSpecifier(spec, aliases);
      const resolved = aliased ?? (spec.startsWith('.') ? join(dirname(file), spec) : spec);
      const cleanId = resolved.split('?')[0];
      if (!existsSync(cleanId)) continue;
      const esmName = `island-${assetHash(cleanId)}`;
      entries[esmName] = `${cleanId}?island=${framework}`;
    }
  }

  return entries;
}

export function islandClientPublicUrl(cleanId: string, framework: string, root: string): string {
  const esmName = `island-${assetHash(cleanId)}`;
  if (process.env.NODE_ENV === 'production') {
    return `${JS_ISLAND_PUBLIC_PATH}/${esmName}.js`;
  }
  const rel = relative(root, cleanId).replace(/\\/g, '/');
  return `/${rel}?island=${framework}`;
}

export function registerIslandClientUrl(cleanId: string, framework: string, root: string): string {
  const esmName = `island-${assetHash(cleanId)}`;
  registerImport(esmName, islandClientPublicUrl(cleanId, framework, root));
  return esmName;
}

/** Vite-dev URL for a file on disk (`/@fs/abs/path`). */
export function viteFsUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.startsWith('/') ? `/@fs${normalized}` : `/@fs/${normalized}`;
}

/**
 * Map a bare runtime specifier (`preact`, `preact/hooks`, `vue`, …) onto the
 * island client bundle. In dev every specifier for a framework must point at
 * the same file — `/@id/preact/hooks` 404s because Vite treats `/@id/` as a
 * single path segment.
 */
export function registerRuntimeSpecifier(
  spec: string,
  productionUrl: string,
  options?: { devUrl?: string }
): void {
  const devUrl = options?.devUrl ?? productionUrl;
  registerImport(spec, process.env.NODE_ENV === 'production' ? productionUrl : devUrl);
}

export function islandPluginResolveId(framework: string, ext: string): Plugin['resolveId'] {
  return async function resolveId(source, importer, options) {
    const requested = getIslandFramework(source, options?.attributes as Record<string, string>);
    if (requested !== framework) return null;

    const { path: sourcePath } = splitIslandId(source);
    const resolved = await this.resolve(sourcePath, importer, {
      skipSelf: true,
      attributes: options?.attributes,
    });
    if (!resolved) return null;

    const resolvedId = typeof resolved === 'string' ? resolved : resolved.id;
    const clean = splitIslandId(resolvedId).path;
    if (!clean.endsWith(ext)) return null;

    return `${clean}?island=${framework}`;
  };
}

/**
 * Island plugins call this from `generateBundle` to map their client runtime chunk
 * onto import-map specifiers. The Vite host does not know about Preact/Svelte/Vue.
 */
export function registerClientChunkAliases(
  bundle: Record<string, { type?: string }>,
  isMatch: (fileName: string) => boolean,
  specifiers: readonly string[]
): void {
  for (const [fileName, chunk] of Object.entries(bundle)) {
    if (chunk?.type && chunk.type !== 'chunk') continue;
    if (!isMatch(fileName)) continue;
    const publicPath = `/${fileName}`;
    const esmName = fileName.split('/').pop()!.replace(/\.js$/, '');
    registerImport(esmName, publicPath);
    for (const spec of specifiers) {
      registerImport(spec, publicPath);
    }
  }
}
