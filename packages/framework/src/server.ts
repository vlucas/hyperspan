import { HSHtml, html, isHSHtml, renderStream, renderAsync, render } from '@hyperspan/html';
import { executeMiddleware } from './middleware';
import type { Hyperspan as HS } from './types';

export const IS_PROD = process.env.NODE_ENV === 'production';
const CWD = process.cwd();

export class HTTPException extends Error {
  constructor(public status: number, message?: string) {
    super(message);
  }
}

export function createContext(req: Request): HS.Context {
  const url = new URL(req.url);
  const query = new URLSearchParams(url.search);
  const method = req.method.toUpperCase();
  const headers = new Headers(req.headers);
  const params = new Map<string, string>();

  return {
    req: {
      raw: req,
      url,
      method,
      headers,
      query,
      params,
      body: req.body,
    },
    res: {
      raw: new Response(),
      html: (html: string, options?: { status?: number; headers?: Headers | Record<string, string> }) => new Response(html, { ...options, headers: { 'Content-Type': 'text/html; charset=UTF-8', ...options?.headers } }),
      json: (json: any, options?: { status?: number; headers?: Headers | Record<string, string> }) => new Response(JSON.stringify(json), { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } }),
      text: (text: string, options?: { status?: number; headers?: Headers | Record<string, string> }) => new Response(text, { ...options, headers: { 'Content-Type': 'text/plain; charset=UTF-8', ...options?.headers } }),
      redirect: (url: string, options?: { status?: number; headers?: Headers | Record<string, string> }) => new Response(null, { status: 302, headers: { Location: url, ...options?.headers } }),
      error: (error: Error, options?: { status?: number; headers?: Headers | Record<string, string> }) => new Response(error.message, { status: 500, ...options }),
      notFound: (options?: { status?: number; headers?: Headers | Record<string, string> }) => new Response('Not Found', { status: 404, ...options }),
    },
  };
}


/**
 * Define a route that can handle a direct HTTP request.
 * Route handlers should return a HSHtml or Response object
 */
export function createRoute(config: { name?: string; path?: string } = {}): HS.Route {
  const _handlers: Record<string, HS.RouteHandler> = {};
  let _middleware: Array<HS.MiddlewareHandler> = [];
  const { name, path } = config;

  const api: HS.Route = {
    _kind: 'hsRoute',
    _name: name,
    _path: path,
    _methods: () => Object.keys(_handlers),
    /**
     * Add a GET route handler (primary page display)
     */
    get(handler: HS.RouteHandler) {
      _handlers['GET'] = handler;
      return api;
    },
    /**
     * Add a POST route handler (typically to process form data)
     */
    post(handler: HS.RouteHandler) {
      _handlers['POST'] = handler;
      return api;
    },
    /**
     * Add a PUT route handler (typically to update existing data)
     */
    put(handler: HS.RouteHandler) {
      _handlers['PUT'] = handler;
      return api;
    },
    /**
     * Add a DELETE route handler (typically to delete existing data)
     */
    delete(handler: HS.RouteHandler) {
      _handlers['DELETE'] = handler;
      return api;
    },
    /**
     * Add a PATCH route handler (typically to update existing data)
     */
    patch(handler: HS.RouteHandler) {
      _handlers['PATCH'] = handler;
      return api;
    },
    /**
     * Add a OPTIONS route handler (typically to handle CORS preflight requests)
     */
    options(handler: HS.RouteHandler) {
      _handlers['OPTIONS'] = handler;
      return api;
    },
    /**
     * Add middleware specific to this route
     */
    middleware(middleware: Array<HS.MiddlewareHandler>) {
      _middleware = middleware;
      return api;
    },
    _getRouteHandlers() {
      return [
        ..._middleware,
        async (context: HS.Context) => {
          const method = context.req.method.toUpperCase();

          // Handle CORS preflight requests (if no OPTIONS handler is defined)
          if (method === 'OPTIONS' && !_handlers['OPTIONS']) {
            return context.res.html(
              render(html`
                <!DOCTYPE html>
                <html lang="en"></html>
              `),
              {
                status: 200,
                headers: {
                  'Access-Control-Allow-Origin': '*',
                  'Access-Control-Allow-Methods': [
                    'HEAD',
                    'OPTIONS',
                    ...Object.keys(_handlers),
                  ].join(', '),
                  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                },
              }
            );
          }

          // Handle other requests, HEAD is GET with no body
          return returnHTMLResponse(context, () => {
            const handler = method === 'HEAD' ? _handlers['GET'] : _handlers[method];

            if (!handler) {
              return context.res.error(new Error('Method not allowed'), { status: 405 });
            }

            return handler(context);
          });
        },
      ];
    },

    /**
     * Fetch - handle a direct HTTP request
     */
    async fetch(request: Request) {
      const context = createContext(request);

      return executeMiddleware(context, api._getRouteHandlers());
    },
  };

  return api;
}

export function createServer(config: HS.Config = {} as HS.Config) {
  const _middleware: HS.MiddlewareHandler[] = [];
  const _routes: HS.Route[] = [];

  const api = {
    _routes: _routes,
    _middleware: _middleware,
    use(middleware: HS.MiddlewareHandler) {
      _middleware.push(middleware);
      return this;
    },
    get(path: string, handler: HS.RouteHandler) {
      const route = createRoute().get(handler);
      route._path = path;
      _routes.push(route);
      return route;
    },
    post(path: string, handler: HS.RouteHandler) {
      const route = createRoute().post(handler);
      route._path = path;
      _routes.push(route);
      return route;
    },
    put(path: string, handler: HS.RouteHandler) {
      const route = createRoute().put(handler);
      route._path = path;
      _routes.push(route);
      return route;
    },
    delete(path: string, handler: HS.RouteHandler) {
      const route = createRoute().delete(handler);
      route._path = path;
      _routes.push(route);
      return route;
    },
    patch(path: string, handler: HS.RouteHandler) {
      const route = createRoute().patch(handler);
      route._path = path;
      _routes.push(route);
      return route;
    }
  };

  return api;
}

/**
 * Return HTML response from userland route handler
 */
export async function returnHTMLResponse(
  context: HS.Context,
  handlerFn: () => unknown,
  responseOptions?: { status?: number; headers?: Record<string, string> }
): Promise<Response> {
  try {
    const routeContent = await handlerFn();

    // Return Response if returned from route handler
    if (routeContent instanceof Response) {
      return routeContent;
    }

    // Render HSHtml if returned from route handler
    if (isHSHtml(routeContent)) {
      // @TODO: Move this to config or something...
      const streamOpt = context.req.query.get('__nostream');
      const streamingEnabled = (streamOpt !== undefined ? streamOpt : true);

      // Stream only if enabled and there is async content to stream
      if (streamingEnabled && (routeContent as HSHtml).asyncContent?.length > 0) {
        return new StreamResponse(
          renderStream(routeContent as HSHtml),
          responseOptions
        ) as Response;
      } else {
        const output = await renderAsync(routeContent as HSHtml);
        return context.res.html(output, responseOptions);
      }
    }

    // Return unknown content as string - not specifically handled above
    return context.res.html(String(routeContent), responseOptions);
  } catch (e) {
    !IS_PROD && console.error(e);
    return await showErrorReponse(context, e as Error, responseOptions);
  }
}

/**
 * Get a Hyperspan runnable route from a module import
 * @throws Error if no runnable route found
 */
export function getRunnableRoute(route: unknown): HS.Route {
  // Runnable already? Just return it
  if (isRunnableRoute(route)) {
    return route as HS.Route;
  }

  const kind = typeof route;

  // Plain function - wrap in createRoute()
  if (kind === 'function') {
    return createRoute(route as HS.RouteHandler);
  }

  // Module - get default and use it
  // @ts-ignore
  if (kind === 'object' && 'default' in route) {
    return getRunnableRoute(route.default);
  }

  // No route -> error
  throw new Error(
    `Route not runnable. Use "export default createRoute()" to create a Hyperspan route. Exported methods found were: ${Object.keys(route as {}).join(', ')}`
  );
}

/**
 * Check if a route is runnable by Hyperspan
 */
export function isRunnableRoute(route: unknown): boolean {
  if (typeof route !== 'object') {
    return false;
  }

  const obj = route as { _kind: string; _getRouteHandlers: any };
  const runnableKind = ['hsRoute', 'hsAPIRoute', 'hsAction'].includes(obj?._kind);

  return runnableKind && '_getRouteHandlers' in obj;
}

/**
 * Basic error handling
 * @TODO: Should check for and load user-customizeable template with special name (app/__error.ts ?)
 */
async function showErrorReponse(
  context: HS.Context,
  err: Error,
  responseOptions?: { status?: number; headers?: Record<string, string> }
) {
  let status: number = 500;
  const message = err.message || 'Internal Server Error';

  // Send correct status code if HTTPException
  if (err instanceof HTTPException) {
    status = err.status;
  }

  const stack = !IS_PROD && err.stack ? err.stack.split('\n').slice(1).join('\n') : '';

  // Partial request (no layout - usually from actions)
  if (context.req.headers.get('X-Request-Type') === 'partial') {
    const output = render(html`
      <section style="padding: 20px;">
        <p style="margin-bottom: 10px;"><strong>Error</strong></p>
        <strong>${message}</strong>
        ${stack ? html`<pre>${stack}</pre>` : ''}
      </section>
    `);
    return context.res.html(output, Object.assign({ status }, responseOptions));
  }

  const output = render(html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Application Error</title>
      </head>
      <body>
        <main>
          <h1>Application Error</h1>
          <strong>${message}</strong>
          ${stack ? html`<pre>${stack}</pre>` : ''}
        </main>
      </body>
    </html>
  `);

  return context.res.html(output, Object.assign({ status }, responseOptions));
}


/**
 * Streaming HTML Response
 */
export class StreamResponse extends Response {
  constructor(iterator: AsyncIterator<unknown>, options: { status?: number; headers?: Record<string, string> } = {}) {
    super();
    const { status, headers, ...restOptions } = options;
    const stream = createReadableStreamFromAsyncGenerator(iterator as AsyncGenerator);

    return new Response(stream, {
      status: status ?? 200,
      headers: {
        'Transfer-Encoding': 'chunked',
        'Content-Type': 'text/html; charset=UTF-8',
        'Content-Encoding': 'Identity',
        ...(headers ?? {}),
      },
      ...restOptions,
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
