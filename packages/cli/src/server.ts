import { Glob } from "bun";
import { createServer, getRunnableRoute, createConfig, normalizePath } from '@hyperspan/framework';
import { join } from "node:path";

import type { Hyperspan as HS } from '@hyperspan/framework';
type startConfig = {
  development?: boolean;
}

const CWD = process.cwd();

export async function loadConfig(): Promise<HS.Config> {
  const configFile = "./hyperspan.config.ts";
  const configModule = await import(configFile).then((module) => module.default).catch(() => ({}) as HS.Config);
  return createConfig(configModule);
}

export async function startServer(startConfig: startConfig = {}): Promise<HS.Server> {
  const config = await loadConfig();
  const server = createServer(config);
  await addRoutes(server, startConfig);
  return server;
}

export async function addRoutes(server: HS.Server, startConfig: startConfig) {
  const routesGlob = new Glob("**/*.ts");
  const routeFiles: string[] = [];
  const appDir = server._config.appDir || "./app";
  const routesDir = join(CWD, appDir, "routes");

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
  const routes = await Promise.all(routeFiles.map(async (filePath) => {
    const routeModule = await import(filePath);
    const route = getRunnableRoute(routeModule);

    // If route is in app/routes, use the file path as the route path (file system routes)
    if (filePath && filePath.includes('app/routes')) {
      const relativePath = filePath.split('app/routes/').pop();
      const path = normalizePath(relativePath ?? '/');
      route._config.path = path;
      routeMap.push({ route: path, file: filePath.replace(CWD, '') });
    }

    return route;
  }));

  if (startConfig.development) {
    console.log('[Hyperspan] Loaded routes:');
    console.table(routeMap);
  }

  server._routes.push(...routes);
}