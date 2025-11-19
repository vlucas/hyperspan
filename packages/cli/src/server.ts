import { Glob } from "bun";
import { createServer, getRunnableRoute, IS_PROD, parsePath } from '@hyperspan/framework';
import { CSS_PUBLIC_PATH, CSS_ROUTE_MAP } from '@hyperspan/framework/client/css';
import { join } from "node:path";

import type { Hyperspan as HS } from '@hyperspan/framework';
type startConfig = {
  development?: boolean;
}

const CWD = process.cwd();

export async function loadConfig(): Promise<HS.Config> {
  const configFile = join(CWD, "hyperspan.config.ts");
  const configModule = await import(configFile).then((module) => module.default).catch((error) => {
    console.error(`[Hyperspan] Unable to load config file: ${error}`);
    console.error(`[Hyperspan] Please create a hyperspan.config.ts file in the root of your project.`);
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
  await addRoutes(server, startConfig);
  return server;
}

export async function addRoutes(server: HS.Server, startConfig: startConfig) {
  const routesGlob = new Glob("**/*.ts");
  const routeFiles: string[] = [];
  const appDir = server._config.appDir || "./app";
  const routesDir = join(CWD, appDir, "routes");
  const buildDir = join(CWD, '.build');
  const cssPublicDir = join(CWD, server._config.publicDir, CSS_PUBLIC_PATH);

  for await (const file of routesGlob.scan(routesDir)) {
    const filePath = join(routesDir, file);

    // Hidden directories and files start with a double underscore.
    // These do not get added to the routes. Nothing nested under them gets added to the routes either.
    if (filePath.includes('/__')) {
      continue;
    }

    routeFiles.push(filePath);
  }

  const routeMap: { route: string, file: string }[] = [];
  const routes: HS.Route[] = await Promise.all(routeFiles.map(async (filePath) => {
    const relativePath = filePath.split('app/routes/').pop();
    const { path } = parsePath(relativePath ?? '/');

    if (path) {
      let cssFiles: string[] = [];

      // Build the route just for the CSS files
      // Wasteful perhaps to compile the JS also and then just discard it, but it's an easy way to do CSS compilation by route
      const buildResult = await Bun.build({
        entrypoints: [filePath],
        outdir: buildDir,
        naming: `app/routes/${path.endsWith('/') ? path + 'index' : path}-[hash].[ext]`,
        minify: IS_PROD,
        format: 'esm',
        target: 'node',
        env: 'APP_PUBLIC_*',
      });

      // Move CSS files to the public directory
      for (const output of buildResult.outputs) {
        if (output.path.endsWith('.css')) {
          const cssFileName = output.path.split('/').pop()!;
          await Bun.write(join(cssPublicDir, cssFileName), Bun.file(output.path));
          cssFiles.push(cssFileName);
        }
      }

      const routeModule = await import(filePath);
      const route = getRunnableRoute(routeModule);

      // Set route path based on the file path
      route._config.path = path;

      if (cssFiles.length > 0) {
        route._config.cssImports = cssFiles;
        CSS_ROUTE_MAP.set(path, cssFiles);
      }

      routeMap.push({ route: path, file: filePath.replace(CWD, '') });

      return route;
    }

    return null;
  }).filter(route => route !== null));

  if (startConfig.development) {
    console.log('[Hyperspan] Loaded routes:');
    console.table(routeMap);
  }

  server._routes.push(...routes);
}