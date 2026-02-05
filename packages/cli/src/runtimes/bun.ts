import { createContext } from "@hyperspan/framework";
import { join } from 'node:path';
import debug from 'debug';

import type { Hyperspan as HS } from '@hyperspan/framework';

const log = debug('hyperspan:cli');

/**
 * Use Bun server. We don't have to do any path parsing here because Bun has its own path parsing logic with param passing in req.params.
 * Using Bun HTTP server directly is the fastest way to serve the app, and is highly recommended for production.
 */
export function startBunServer(server: HS.Server) {
  const routes: Record<string, ((request: Request) => Promise<Response>) | Response> = {};

  // Add routemap for Bun server
  for (const route of server._routes) {
    const path = route._path();

    // Add server config to route
    route._serverConfig = server._config;

    // Add server middleware to route. Server middleware will run before the route middleware.
    if (server._middleware && route._middleware) {
      for (const method of Object.keys(server._middleware) as HS.MiddlewareMethod[]) {
        if (Array.isArray(server._middleware[method]) && Array.isArray(route._middleware[method])) {
          route._middleware[method] = server._middleware[method].concat(route._middleware[method]);
        }
      }
    }

    // Add main route
    routes[path] = (request: Request) => {
      return route.fetch(request);
    }

    // Add trailing slash route to redirect to the main route if the main route doesn't have a trailing slash
    if (!path.endsWith('/')) {
      routes[path + '/'] = Response.redirect(path);
    }

    // Wildcard routes need a base route *without* the slash to redirect to the route *with* the slash
    // Bun seems to not allow wildcard routes without a slash before the wildcard segment, so they always have a trailing slash
    if (path.endsWith('/*')) {
      const pathWithoutWildcard = path.replace('/*', '');
      routes[pathWithoutWildcard] = Response.redirect(pathWithoutWildcard + '/');
    }
  }

  const httpServer = Bun.serve({
    development: process.env.NODE_ENV === 'development',
    routes,
    fetch: async (request: Request) => {
      const url = new URL(request.url);

      // Serve static files from the public directory
      const file = Bun.file(join('./', server._config.publicDir, url.pathname))
      const fileExists = await file.exists()
      if (fileExists) {
        log(`Serving static file: ${url.pathname}`);
        return new Response(file);
      }

      log(`Serving 404: ${url.pathname}`);
      return createContext(request).res.notFound();
    },
  });

  return httpServer;
}