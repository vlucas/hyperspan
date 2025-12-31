import { Glob } from 'bun';
import { createServer, getRunnableRoute, IS_PROD, isValidRoutePath, parsePath } from '@hyperspan/framework';
import { CSS_PUBLIC_PATH, CSS_ROUTE_MAP } from '@hyperspan/framework/client/css';
import { join } from 'node:path';
import tailwind from "bun-plugin-tailwind"

import type { Hyperspan as HS } from '@hyperspan/framework';

type startConfig = {
  development?: boolean;
};

const CWD = process.cwd();

export async function loadConfig(): Promise<HS.Config> {
  const configFile = join(CWD, 'hyperspan.config.ts');
  const configModule = await import(configFile)
    .then((module) => module.default)
    .catch((error) => {
      console.error(`[Hyperspan] Unable to load config file: ${error}`);
      console.error(
        `[Hyperspan] Please create a hyperspan.config.ts file in the root of your project.`
      );
      console.log(`[Hyperspan] Example:
import { createConfig } from '@hyperspan/framework';

export default createConfig({
  appDir: './app',
  publicDir: './public',
});
`);
      process.exit(1);
    });
  return configModule;
}

export async function startServer(startConfig: startConfig = {}): Promise<HS.Server> {
  console.log('[Hyperspan] Loading config...');
  const config = await loadConfig();
  const server = await createServer(config);
  console.log('[Hyperspan] Adding routes...');
  await addDirectoryAsRoutes(server, 'routes', startConfig);
  console.log('[Hyperspan] Adding actions...');
  await addDirectoryAsRoutes(server, 'actions', startConfig);
  return server;
}

export async function addDirectoryAsRoutes(
  server: HS.Server,
  relativeDirectory: string,
  startConfig: startConfig = {}
) {
  const routesGlob = new Glob('**/*.ts');
  const files: string[] = [];
  const appDir = server._config.appDir || './app';
  const relativeAppPath = join(appDir, relativeDirectory);
  const directoryPath = join(CWD, appDir, relativeDirectory);
  const buildDir = join(CWD, '.build');
  const cssPublicDir = join(CWD, server._config.publicDir, CSS_PUBLIC_PATH);

  // Scan directory for TypeScript files
  for await (const file of routesGlob.scan(directoryPath)) {
    const filePath = join(directoryPath, file);

    // Hidden directories and files start with a double underscore.
    // These do not get added to the routes. Nothing nested under them gets added to the routes either.
    if (filePath.includes('/__')) {
      continue;
    }

    files.push(filePath);
  }

  const routeMap: { route: string; file: string }[] = [];
  const routes: Array<HS.Route> = (await Promise.all(
    files.map(async (filePath) => {
      const relativeFilePath = filePath.split(relativeAppPath).pop() || '';
      if (!isValidRoutePath(relativeFilePath)) {
        return null;
      }
      const module = await import(filePath);
      const route = getRunnableRoute(module);
      const parsedPath = parsePath(relativeFilePath);

      // If route has a _path() method that returns a meaningful path, use it
      // Otherwise, parse path from file path
      let path = parsedPath.path;
      if (typeof route._path === 'function') {
        const routePath = route._path();
        // If _path() returns a meaningful path (not just '/'), use it
        if (routePath && routePath !== '/') {
          path = routePath;
        }
      }

      let cssFiles: string[] = [];

      // Build the route just for the CSS files (expensive, but easiest way to do CSS compilation by route)
      // @TODO: Optimize this at some later date... This is O(n) for each route and doesn't scale well for large projects.
      // @TODO: This will also currently re-compile the same CSS file(s) that are included in multiple routes, which is dumb.
      const buildResult = await Bun.build({
        plugins: [tailwind],
        entrypoints: [filePath],
        outdir: buildDir,
        naming: `${relativeAppPath}/${path.endsWith('/') ? path + 'index' : path}-[hash].[ext]`,
        minify: IS_PROD,
        format: 'esm',
        target: 'node',
      });

      // Move CSS files to the public directory
      for (const output of buildResult.outputs) {
        if (output.path.endsWith('.css')) {
          const cssFileName = output.path.split('/').pop()!;
          await Bun.write(join(cssPublicDir, cssFileName), Bun.file(output.path));
          cssFiles.push(cssFileName);
        }
      }

      // Set route path based on the file path (if not already set)
      if (!route._config.path) {
        route._config.path = path;
      }

      if (cssFiles.length > 0) {
        route._config.cssImports = cssFiles;
        CSS_ROUTE_MAP.set(path, cssFiles);
      }

      routeMap.push({ route: path, file: filePath.replace(CWD, '') });

      return route;
    })
  )).filter((route) => route !== null);

  if (startConfig.development) {
    console.table(routeMap);
  }

  server._routes.push(...routes);
}
