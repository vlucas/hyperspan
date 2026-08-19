import type { Hyperspan as HS } from '../types';

export type AssetManifest = {
  imports: Record<string, string>;
  css: Record<string, string[]>;
  clients: Record<string, string>;
};

let _manifest: AssetManifest = {
  imports: {},
  css: {},
  clients: {},
};

/**
 * Set the build-time asset manifest (called by Vite plugin or build step).
 */
export function setAssetManifest(manifest: AssetManifest): void {
  _manifest = {
    imports: manifest.imports ?? {},
    css: manifest.css ?? {},
    clients: manifest.clients ?? {},
  };
}

/**
 * Get the current asset manifest.
 */
export function getAssetManifest(): AssetManifest {
  return _manifest;
}

/**
 * Resolve a module import name to its public URL.
 */
export function resolveImport(name: string): string | undefined {
  return _manifest.imports[name];
}

/**
 * Get CSS files for a route path.
 */
export function getRouteCss(path: string): string[] {
  return _manifest.css[path] ?? [];
}

/**
 * Build import map object for layout script tags.
 */
export function getImportMap(): Record<string, string> {
  return { ..._manifest.imports };
}

/**
 * Register a client module URL at runtime (dev fallback).
 */
export function registerImport(name: string, publicPath: string): void {
  _manifest.imports[name] = publicPath;
}

export type ClientJSBuildResult = HS.ClientJSBuildResult;

/**
 * Create a ClientJSBuildResult from manifest data (replaces runtime Bun.build).
 */
export function getClientJSFromManifest(
  moduleId: string,
  _exportNames = 'default'
): ClientJSBuildResult {
  const publicPath = _manifest.clients[moduleId];
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
