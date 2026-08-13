import type { Plugin } from 'vite';
import { registerImport } from '@hyperspan/framework';

export type IslandFramework = string;

export type IslandPluginRegistration = {
  vitePlugin: () => Plugin;
};

const loadedIslandPlugins = new Map<string, IslandPluginRegistration>();

export function registerIslandPlugin(
  framework: string,
  registration: IslandPluginRegistration
): void {
  loadedIslandPlugins.set(framework, registration);
}

export function isIslandPluginLoaded(framework: string): boolean {
  return loadedIslandPlugins.has(framework);
}

export function resetIslandPluginsForTests(): void {
  loadedIslandPlugins.clear();
}

export function getRegisteredIslandFrameworks(): string[] {
  return [...loadedIslandPlugins.keys()];
}

/** Vite plugins for frameworks registered via hyperspan.config.ts. */
export function resolveRegisteredIslandVitePlugins(): Plugin[] {
  return [...loadedIslandPlugins.values()].map((entry) => entry.vitePlugin());
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
  const registration = loadedIslandPlugins.get(framework);
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
