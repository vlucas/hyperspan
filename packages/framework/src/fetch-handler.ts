import { createContext } from './server';
import type { Hyperspan as HS } from './types';

export type FetchHandlerOptions = {
  /** Called when no route matches (before 404). Return a Response to handle static assets etc. */
  onNotMatched?: (request: Request) => Promise<Response | undefined>;
};

type CompiledRoute = {
  route: HS.Route;
  pattern: RegExp;
  paramNames: string[];
  isWildcard: boolean;
};

/**
 * Convert a Hyperspan route path (`/users/:id`, `/blog/*`) into a RegExp + param names.
 */
export function compileRoutePath(path: string): {
  pattern: RegExp;
  paramNames: string[];
  isWildcard: boolean;
} {
  const paramNames: string[] = [];
  const isWildcard = path.endsWith('/*');

  if (path === '/') {
    return { pattern: /^\/$/, paramNames, isWildcard: false };
  }

  const segments = path.split('/').filter(Boolean);
  const regexParts = segments.map((segment) => {
    if (segment === '*') {
      paramNames.push('...slug');
      return '(.+)';
    }
    if (segment.startsWith(':')) {
      paramNames.push(segment.slice(1));
      return '([^/]+)';
    }
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });

  const pattern = new RegExp(`^/${regexParts.join('/')}${isWildcard ? '' : '/?'}$`);
  return { pattern, paramNames, isWildcard };
}

function mergeRouteMiddleware(server: HS.Server, route: HS.Route): void {
  route._serverConfig = server._config;

  if (!server._middleware || !route._middleware) {
    return;
  }

  for (const method of Object.keys(server._middleware) as HS.MiddlewareMethod[]) {
    if (Array.isArray(server._middleware[method]) && Array.isArray(route._middleware[method])) {
      route._middleware[method] = server._middleware[method].concat(route._middleware[method]);
    }
  }
}

function matchRoute(
  compiledRoutes: CompiledRoute[],
  pathname: string,
  method: string
): { route: HS.Route; params: Record<string, string | undefined> } | null {
  for (const compiled of compiledRoutes) {
    const match = pathname.match(compiled.pattern);
    if (!match) {
      continue;
    }

    // Actions and some custom handlers may not expose _methods(); treat as all methods.
    const routeMethods =
      typeof compiled.route._methods === 'function' ? compiled.route._methods() : ['*'];
    const supportsMethod =
      routeMethods.includes(method) ||
      routeMethods.includes('*') ||
      (method === 'HEAD' && routeMethods.includes('GET'));

    if (!supportsMethod) {
      continue;
    }

    const params: Record<string, string | undefined> = {};
    compiled.paramNames.forEach((name, index) => {
      const value = match[index + 1];
      if (name.startsWith('...')) {
        params[name] = value;
      } else {
        params[name] = value;
      }
    });

    return { route: compiled.route, params };
  }

  return null;
}

function trailingSlashRedirect(pathname: string, request: Request): Response | null {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    const url = new URL(request.url);
    url.pathname = pathname.slice(0, -1);
    return Response.redirect(url.toString(), 308);
  }
  return null;
}

/**
 * Create a portable fetch handler for a Hyperspan server.
 * Works on Node, Bun, Cloudflare Workers, and any runtime with Web Fetch API.
 */
export function createFetchHandler(
  server: HS.Server,
  options: FetchHandlerOptions = {}
): (request: Request) => Promise<Response> {
  const compiledRoutes: CompiledRoute[] = server._routes.map((route) => {
    const path = route._path();
    mergeRouteMiddleware(server, route);
    const { pattern, paramNames, isWildcard } = compileRoutePath(path);
    return { route, pattern, paramNames, isWildcard };
  });

  // Longer / more specific paths first (more segments wins)
  compiledRoutes.sort((a, b) => {
    const aSegments = a.route._path().split('/').filter(Boolean).length;
    const bSegments = b.route._path().split('/').filter(Boolean).length;
    return bSegments - aSegments;
  });

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    const slashRedirect = trailingSlashRedirect(pathname, request);
    if (slashRedirect) {
      return slashRedirect;
    }

    const matched = matchRoute(compiledRoutes, pathname, method);
    if (matched) {
      const reqWithParams = new Request(request);
      (reqWithParams as Request & { params?: Record<string, string | undefined> }).params =
        matched.params;
      return matched.route.fetch(reqWithParams);
    }

    if (options.onNotMatched) {
      const staticResponse = await options.onNotMatched(request);
      if (staticResponse) {
        return staticResponse;
      }
    }

    return createContext(request).res.notFound();
  };
}

/**
 * Create an app object with a fetch method (adapter contract).
 */
export function createApp(server: HS.Server, options: FetchHandlerOptions = {}) {
  const fetch = createFetchHandler(server, options);
  return { fetch, server };
}
