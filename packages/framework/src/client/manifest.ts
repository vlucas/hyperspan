import type { Hyperspan as HS } from '../types';

export type AssetManifest = {
  imports: Record<string, string>;
  css: Record<string, string[]>;
  clients: Record<string, string>;
};

const MANIFEST_KEY = Symbol.for('@hyperspan/asset-manifest');

function sharedManifest(): AssetManifest {
  const globalStore = globalThis as typeof globalThis & {
    [MANIFEST_KEY]?: AssetManifest;
  };
  if (!globalStore[MANIFEST_KEY]) {
    globalStore[MANIFEST_KEY] = { imports: {}, css: {}, clients: {} };
  }
  return globalStore[MANIFEST_KEY];
}

/**
 * Set the build-time asset manifest (called by Vite plugin or build step).
 */
export function setAssetManifest(manifest: AssetManifest): void {
  const store = sharedManifest();
  store.imports = { ...(manifest.imports ?? {}) };
  store.css = { ...(manifest.css ?? {}) };
  store.clients = { ...(manifest.clients ?? {}) };
}

/**
 * Get the current asset manifest.
 */
export function getAssetManifest(): AssetManifest {
  return sharedManifest();
}

/**
 * Resolve a module import name to its public URL.
 */
export function resolveImport(name: string): string | undefined {
  return sharedManifest().imports[name];
}

/**
 * Get CSS files for a route path.
 */
export function getRouteCss(path: string): string[] {
  return sharedManifest().css[path] ?? [];
}

/**
 * Build import map object for layout script tags.
 */
export function getImportMap(): Record<string, string> {
  return { ...sharedManifest().imports };
}

/**
 * Register a client module URL at runtime (dev fallback).
 */
export function registerImport(name: string, publicPath: string): void {
  sharedManifest().imports[name] = publicPath;
}

export type ClientJSBuildResult = HS.ClientJSBuildResult;

/**
 * Create a ClientJSBuildResult from manifest data (replaces runtime Bun.build).
 */
export function getClientJSFromManifest(
  moduleId: string,
  _exportNames = 'default'
): ClientJSBuildResult {
  const publicPath = sharedManifest().clients[moduleId];
  if (!publicPath) {
    throw new Error(
      `[Hyperspan] Client module "${moduleId}" not found in asset manifest. Run hyperspan build or start dev server.`
    );
  }

  const esmName = publicPath.split('/').pop()?.replace('.js', '') ?? moduleId;

  return {
    assetHash: moduleId,
    esmName,
    publicPath,
    renderScriptTag: () => {
      throw new Error('renderScriptTag requires html template - use layout helpers instead');
    },
  };
}
