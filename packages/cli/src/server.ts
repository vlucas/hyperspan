import { Glob } from "bun";
import { createServer, getRunnableRoute, createConfig, normalizePath } from '@hyperspan/framework';
import { join } from "node:path";

import type { Hyperspan as HS } from '@hyperspan/framework';

const CWD = process.cwd();

export async function loadConfig(): Promise<HS.Config> {
  const configFile = "./hyperspan.config.ts";
  const configModule = await import(configFile).then((module) => module.default).catch(() => ({}) as HS.Config);
  return createConfig(configModule);
}

export async function startServer(): Promise<HS.Server> {
  const config = await loadConfig();
  const server = createServer(config);
  await addRoutes(server);
  return server;
}

export async function addRoutes(server: HS.Server) {
  const routesGlob = new Glob("**/*.ts");
  const routeFiles: string[] = [];
  const appDir = server._config.appDir || "./app";
  const routesDir = join(CWD, appDir, "routes");

  for await (const file of routesGlob.scan(routesDir)) {
    routeFiles.push(join(routesDir, file));
  }

  const routes = await Promise.all(routeFiles.map(async (filePath) => {
    const routeModule = await import(filePath);
    const route = getRunnableRoute(routeModule);

    // If route is in app/routes, use the file path as the route path (file system routes)
    if (filePath && filePath.includes('app/routes')) {
      const relativePath = filePath.split('app/routes/').pop();
      const path = normalizePath(relativePath ?? '/');
      route._config.path = path;
    }

    return route;
  }));

  server._routes.push(...routes);
}