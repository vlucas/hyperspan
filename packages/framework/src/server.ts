import { readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { TmplHtml, html, renderStream, renderAsync, render } from '@hyperspan/html';
import { isbot } from 'isbot';
import { buildClientJS, buildClientCSS } from './assets';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import type { Context, Handler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { create } from 'node:domain';

export const IS_PROD = process.env.NODE_ENV === 'production';
const CWD = process.cwd();

/**
 * Types
 */
export type THSResponseTypes = TmplHtml | Response | string | null;
export type THSRouteHandler = (context: Context) => THSResponseTypes | Promise<THSResponseTypes>;

/**
 * Route
 * Define a route that can handle a direct HTTP request
 * Route handlers should return a Response or TmplHtml object
 */
export function createRoute(handler?: THSRouteHandler) {
  let _handlers: Record<string, THSRouteHandler> = {};

  if (handler) {
    _handlers['GET'] = handler;
  }

  const api = {
    _kind: 'hsRoute',
    get(handler: THSRouteHandler) {
      _handlers['GET'] = handler;
      return api;
    },
    post(handler: THSRouteHandler) {
      _handlers['POST'] = handler;
      return api;
    },
    put(handler: THSRouteHandler) {
      _handlers['PUT'] = handler;
      return api;
    },
    delete(handler: THSRouteHandler) {
      _handlers['DELETE'] = handler;
      return api;
    },
    patch(handler: THSRouteHandler) {
      _handlers['PATCH'] = handler;
      return api;
    },
    async run(method: string, context: Context): Promise<Response> {
      const handler = _handlers[method];
      if (!handler) {
        throw new HTTPException(405, { message: 'Method not allowed' });
      }

      const routeContent = await handler(context);

      // Return Response if returned from route handler
      if (routeContent instanceof Response) {
        return routeContent;
      }

      // @TODO: Move this to config or something...
      const userIsBot = isbot(context.req.header('User-Agent'));
      const streamOpt = context.req.query('__nostream');
      const streamingEnabled = !userIsBot && (streamOpt !== undefined ? streamOpt : true);
      const routeKind = typeof routeContent;

      // Render TmplHtml if returned from route handler
      if (
        routeContent &&
        routeKind === 'object' &&
        (routeContent instanceof TmplHtml ||
          routeContent.constructor.name === 'TmplHtml' ||
          // @ts-ignore
          routeContent?._kind === 'TmplHtml')
      ) {
        if (streamingEnabled) {
          return new StreamResponse(renderStream(routeContent as TmplHtml)) as Response;
        } else {
          const output = await renderAsync(routeContent as TmplHtml);
          return context.html(output);
        }
      }

      // Return unknown content - not specifically handled above
      return context.text(String(routeContent));
    },
  };

  return api;
}
export type THSRoute = ReturnType<typeof createRoute>;

/**
 * Create new API Route
 * API Route handlers should return a JSON object or a Response
 */
export function createAPIRoute(handler?: THSRouteHandler) {
  let _handlers: Record<string, THSRouteHandler> = {};

  if (handler) {
    _handlers['GET'] = handler;
  }

  const api = {
    _kind: 'hsRoute',
    get(handler: THSRouteHandler) {
      _handlers['GET'] = handler;
      return api;
    },
    post(handler: THSRouteHandler) {
      _handlers['POST'] = handler;
      return api;
    },
    put(handler: THSRouteHandler) {
      _handlers['PUT'] = handler;
      return api;
    },
    delete(handler: THSRouteHandler) {
      _handlers['DELETE'] = handler;
      return api;
    },
    patch(handler: THSRouteHandler) {
      _handlers['PATCH'] = handler;
      return api;
    },
    async run(method: string, context: Context): Promise<Response> {
      const handler = _handlers[method];
      if (!handler) {
        throw new Error('Method not allowed');
      }

      try {
        const response = await handler(context);

        if (response instanceof Response) {
          return response;
        }

        return context.json(
          { meta: { success: true, dtResponse: new Date() }, data: response },
          { status: 200 }
        );
      } catch (err) {
        const e = err as Error;
        console.error(e);

        return context.json(
          {
            meta: { success: false, dtResponse: new Date() },
            data: {},
            error: {
              message: e.message,
              stack: IS_PROD ? undefined : e.stack?.split('\n'),
            },
          },
          { status: 500 }
        );
      }
    },
  };

  return api;
}
export type THSAPIRoute = ReturnType<typeof createAPIRoute>;

/**
 * Get a Hyperspan runnable route from a module import
 * @throws Error if no runnable route found
 */
export function getRunnableRoute(route: unknown): THSRoute {
  // Runnable already? Just return it
  if (isRouteRunnable(route)) {
    return route as THSRoute;
  }

  const kind = typeof route;

  // Plain function - wrap in createRoute()
  if (kind === 'function') {
    return createRoute(route as THSRouteHandler);
  }

  // Module - get default and use it
  // @ts-ignore
  if (kind === 'object' && 'default' in route) {
    return getRunnableRoute(route.default);
  }

  // No route -> error
  throw new Error(
    'Route not runnable. Use "export default createRoute()" to create a Hyperspan route.'
  );
}

export function isRouteRunnable(route: unknown): boolean {
  // @ts-ignore
  return typeof route === 'object' && 'run' in route;
}

/**
 * Basic error handling
 * @TODO: Should check for and load user-customizeable template with special name (app/__error.ts ?)
 */
async function showErrorReponse(context: Context, err: Error) {
  const output = render(html`
    <main>
      <h1>Error</h1>
      <pre>${err.message}</pre>
      <pre>${!IS_PROD && err.stack ? err.stack.split('\n').slice(1).join('\n') : ''}</pre>
    </main>
  `);

  return context.html(output, {
    status: 500,
  });
}

export type THSServerConfig = {
  appDir: string;
  staticFileRoot: string;
  rewrites?: Array<{ source: string; destination: string }>;
  // For customizing the routes and adding your own...
  beforeRoutesAdded?: (app: Hono) => void;
  afterRoutesAdded?: (app: Hono) => void;
};

export type THSRouteMap = {
  file: string;
  route: string;
  params: string[];
};

/**
 * Build routes
 */
const ROUTE_SEGMENT = /(\[[a-zA-Z_\.]+\])/g;
export async function buildRoutes(config: THSServerConfig): Promise<THSRouteMap[]> {
  // Walk all pages and add them as routes
  const routesDir = join(config.appDir, 'routes');
  console.log(routesDir);
  const files = await readdir(routesDir, { recursive: true });
  const routes: THSRouteMap[] = [];

  for (const file of files) {
    // No directories
    if (!file.includes('.') || basename(file).startsWith('.')) {
      continue;
    }

    let route = '/' + file.replace(extname(file), '');

    // Index files
    if (route.endsWith('index')) {
      route = route === 'index' ? '/' : route.substring(0, route.length - 6);
    }

    // Dynamic params
    let params: string[] = [];
    const dynamicPaths = ROUTE_SEGMENT.test(route);

    if (dynamicPaths) {
      params = [];
      route = route.replace(ROUTE_SEGMENT, (match: string) => {
        const paramName = match.replace(/[^a-zA-Z_\.]+/g, '');

        if (match.includes('...')) {
          params.push(paramName.replace('...', ''));
          return '*';
        } else {
          params.push(paramName);
          return ':' + paramName;
        }
      });
    }

    routes.push({
      file: join('./', routesDir, file),
      route: route || '/',
      params,
    });
  }

  return routes;
}

/**
 * Run route from file
 */
export function createRouteFromModule(RouteModule: any): (context: Context) => Promise<Response> {
  return async (context: Context) => {
    const reqMethod = context.req.method.toUpperCase();

    try {
      const runnableRoute = getRunnableRoute(RouteModule);
      const content = await runnableRoute.run(reqMethod, context);

      if (content instanceof Response) {
        return content;
      }

      return context.text(String(content));
    } catch (e) {
      console.error(e);
      return await showErrorReponse(context, e as Error);
    }
  };
}

/**
 * Create and start Bun HTTP server
 */
export async function createServer(config: THSServerConfig): Promise<Hono> {
  // Build client JS and CSS bundles so they are available for templates when streaming starts
  await Promise.all([buildClientJS(), buildClientCSS()]);

  const app = new Hono();

  // [Customization] Before routes added...
  config.beforeRoutesAdded && config.beforeRoutesAdded(app);

  // Scan routes folder and add all file routes to the router
  const fileRoutes = await buildRoutes(config);
  const routeMap = [];

  for (let i = 0; i < fileRoutes.length; i++) {
    let route = fileRoutes[i];
    const fullRouteFile = join(CWD, route.file);
    const routePattern = normalizePath(route.route);

    routeMap.push({ route: routePattern, file: route.file });

    // Import route
    const routeModule = await import(fullRouteFile);

    app.all(routePattern, createRouteFromModule(routeModule));
  }

  // Help route if no routes found
  if (routeMap.length === 0) {
    app.get('/', (context) => {
      return context.text(
        'No routes found. Add routes to app/routes. Example: `app/routes/index.ts`',
        { status: 404 }
      );
    });
  }

  // Display routing table for dev env
  if (!IS_PROD) {
    console.log('[Hyperspan] File system routes (in app/routes):');
    console.table(routeMap);
  }

  // [Customization] After routes added...
  config.afterRoutesAdded && config.afterRoutesAdded(app);

  // Static files and catchall
  app.use(
    '*',
    serveStatic({
      root: config.staticFileRoot,
      onFound: IS_PROD
        ? (_, c) => {
            // Cache static assets in prod (default 30 days)
            c.header('Cache-Control', 'public, max-age=2592000');
          }
        : undefined,
    })
  );

  app.notFound((context) => {
    return context.text('Not... found?', { status: 404 });
  });

  return app;
}

/**
 * Streaming HTML Response
 */
export class StreamResponse extends Response {
  constructor(iterator: AsyncIterator<unknown>, options = {}) {
    super();
    const stream = createReadableStreamFromAsyncGenerator(iterator as AsyncGenerator);

    return new Response(stream, {
      status: 200,
      headers: {
        'Transfer-Encoding': 'chunked',
        'Content-Type': 'text/html; charset=UTF-8',
        'Content-Encoding': 'Identity',
        // @ts-ignore
        ...(options?.headers ?? {}),
      },
      ...options,
    });
  }
}

/**
 * Does what it says on the tin...
 */
export function createReadableStreamFromAsyncGenerator(output: AsyncGenerator) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      while (true) {
        const { done, value } = await output.next();

        if (done) {
          controller.close();
          break;
        }

        controller.enqueue(encoder.encode(value as unknown as string));
      }
    },
  });
}

/**
 * Normalize URL path
 * Removes trailing slash and lowercases path
 */
export function normalizePath(urlPath: string): string {
  return (
    (urlPath.endsWith('/') ? urlPath.substring(0, urlPath.length - 1) : urlPath).toLowerCase() ||
    '/'
  );
}
