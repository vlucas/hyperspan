import { getRunnableRoute } from './server';
import { isValidRoutePath, parsePath } from './utils';
import type { AssetManifest } from './client/manifest';
import type { Hyperspan as HS } from './types';

export type RouteModuleEntry = {
  file: string;
  mod: unknown;
};

/**
 * Register a route or action module on a Hyperspan server.
 * Shared by the CLI, Vite plugin, and the generated production server entry.
 */
export function registerRouteModule(
  server: HS.Server,
  relativeFilePath: string,
  mod: unknown,
  manifest?: AssetManifest
): HS.Route | null {
  if (!isValidRoutePath(relativeFilePath)) {
    return null;
  }

  const route = getRunnableRoute(mod);
  const parsedPath = parsePath(relativeFilePath);

  let path = parsedPath.path;
  if (typeof route._path === 'function') {
    const routePath = route._path();
    if (routePath && routePath !== '/') path = routePath;
  }

  if (!route._config.path) {
    route._config.path = path;
    if (parsedPath.params.length > 0) {
      const params = route._config.params ?? {};
      parsedPath.params.forEach((param) => {
        params[param] = undefined;
      });
      route._config.params = params;
    }
  }

  if (manifest) {
    const cssFiles = manifest.css?.[path] ?? manifest.css?.['*'];
    if (cssFiles?.length) {
      route._config.cssImports = cssFiles;
    }
  }

  server._routes.push(route);
  return route;
}

export function registerRouteModules(
  server: HS.Server,
  modules: RouteModuleEntry[],
  manifest?: AssetManifest
): void {
  for (const { file, mod } of modules) {
    registerRouteModule(server, file, mod, manifest);
  }
}
