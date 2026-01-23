import { HSHtml, html, isHSHtml, renderStream, renderAsync, render, _typeOf } from '@hyperspan/html';
import { isbot } from 'isbot';
import { executeMiddleware } from './middleware';
import { parsePath } from './utils';
import { Cookies } from './cookies';

import type { Hyperspan as HS } from './types';

export const IS_PROD = process.env.NODE_ENV === 'production';

export class HTTPResponseException extends Error {
  public _error?: Error;
  public _response?: Response;
  constructor(body: string | Error | undefined, options?: ResponseInit) {
    super(body instanceof Error ? body.message : body);
    this._error = body instanceof Error ? body : undefined;
    this._response = new Response(body instanceof Error ? body.message : body, options);
  }
}

/**
 * Ensures a valid config object is returned, even with an empty object or partial object passed in
 */
export function createConfig(config: Partial<HS.Config> = {}): HS.Config {
  const defaultConfig: HS.Config = {
    appDir: './app',
    publicDir: './public',
    plugins: [],
    responseOptions: {
      // Disable streaming for bots by default
      disableStreaming: (c) => isbot(c.req.raw.headers.get('user-agent') ?? ''),
    },
  };
  return {
    ...defaultConfig,
    ...config,
    responseOptions: {
      ...defaultConfig.responseOptions,
      ...config.responseOptions,
    },
  };
}

/**
 * Creates a context object for a request
 */
export function createContext(req: Request, route?: HS.Route): HS.Context {
  const url = new URL(req.url);
  const query = new URLSearchParams(url.search);
  const method = req.method.toUpperCase();
  const headers = new Headers(req.headers);
  const path = route?._path() || '/';
  // @ts-ignore - Bun will put 'params' on the Request object even though it's not standardized
  const params: HS.RouteParamsParser<path> & Record<string, string | undefined> = Object.assign({}, req?.params || {}, route?._config.params || {});

  // Replace catch-all param with the value from the URL path
  const catchAllParam = Object.keys(params).find(key => key.startsWith('...'));
  if (catchAllParam && path.includes('/*')) {
    const catchAllValue = url.pathname.split(path.replace('/*', '/')).pop();
    params[catchAllParam.replace('...', '')] = catchAllValue;
    delete params[catchAllParam];
  }

  // Status override for the response. Will use if set. (e.g. c.res.status = 400)
  let status: number | undefined = undefined;

  const merge = async (response: Response) => {
    // Convert headers to plain objects and merge (response headers override context headers)
    const mergedHeaders = {
      ...Object.fromEntries(headers.entries()),
      ...Object.fromEntries(response.headers.entries()),
    };

    return new Response(await response.text(), {
      status: context.res.status ?? response.status,
      headers: mergedHeaders,
    });
  };

  const context: HS.Context = {
    vars: {},
    route: {
      name: route?._config.name || undefined,
      path,
      params: params,
      cssImports: route ? route._config.cssImports ?? [] : [],
    },
    req: {
      raw: req,
      url,
      method,
      headers,
      query,
      cookies: new Cookies(req),
      async text() { return req.clone().text() },
      async json<T = unknown>() { return await req.clone().json() as T },
      async formData<T = unknown>() { return await req.clone().formData() as T },
      async urlencoded() { return new URLSearchParams(await req.clone().text()) },
    },
    res: {
      cookies: new Cookies(req, headers),
      headers,
      status,
      html: (html: string, options?: ResponseInit) => merge(new Response(html, { ...options, headers: { 'Content-Type': 'text/html; charset=UTF-8', ...options?.headers } })),
      json: (json: any, options?: ResponseInit) => merge(new Response(JSON.stringify(json), { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } })),
      text: (text: string, options?: ResponseInit) => merge(new Response(text, { ...options, headers: { 'Content-Type': 'text/plain; charset=UTF-8', ...options?.headers } })),
      redirect: (url: string, options?: ResponseInit) => merge(new Response(null, { status: 302, headers: { Location: url, ...options?.headers } })),
      error: (error: Error, options?: ResponseInit) => merge(new Response(error.message, { status: 500, ...options })),
      notFound: (options?: ResponseInit) => merge(new Response('Not Found', { status: 404, ...options })),
      merge,
    },
  };

  return context;
}


/**
 * Define a route that can handle a direct HTTP request.
 * Route handlers should return a HSHtml or Response object
 */
export function createRoute(config: Partial<HS.RouteConfig> = {}): HS.Route {
  const _handlers: Record<string, HS.RouteHandler> = {};
  let _errorHandler: HS.ErrorHandler | undefined = undefined;
  let _middleware: Record<string, Array<HS.MiddlewareFunction>> = { '*': [] };

  const api: HS.Route = {
    _kind: 'hsRoute',
    _config: config,
    _methods: () => Object.keys(_handlers),
    _path() {
      if (this._config.path) {
        const { path } = parsePath(this._config.path);
        return path;
      }

      return '/';
    },
    /**
     * Add a GET route handler (primary page display)
     */
    get(handler: HS.RouteHandler, handlerOptions?: HS.RouteHandlerOptions) {
      _handlers['GET'] = handler;
      _middleware['GET'] = handlerOptions?.middleware || [];
      return api;
    },
    /**
     * Add a POST route handler (typically to process form data)
     */
    post(handler: HS.RouteHandler, handlerOptions?: HS.RouteHandlerOptions) {
      _handlers['POST'] = handler;
      _middleware['POST'] = handlerOptions?.middleware || [];
      return api;
    },
    /**
     * Add a PUT route handler (typically to update existing data)
     */
    put(handler: HS.RouteHandler, handlerOptions?: HS.RouteHandlerOptions) {
      _handlers['PUT'] = handler;
      _middleware['PUT'] = handlerOptions?.middleware || [];
      return api;
    },
    /**
     * Add a PATCH route handler (typically to update existing data)
     */
    patch(handler: HS.RouteHandler, handlerOptions?: HS.RouteHandlerOptions) {
      _handlers['PATCH'] = handler;
      _middleware['PATCH'] = handlerOptions?.middleware || [];
      return api;
    },
    /**
     * Add a DELETE route handler (typically to delete existing data)
     */
    delete(handler: HS.RouteHandler, handlerOptions?: HS.RouteHandlerOptions) {
      _handlers['DELETE'] = handler;
      _middleware['DELETE'] = handlerOptions?.middleware || [];
      return api;
    },
    /**
     * Add a OPTIONS route handler (typically to handle CORS preflight requests)
     */
    options(handler: HS.RouteHandler, handlerOptions?: HS.RouteHandlerOptions) {
      _handlers['OPTIONS'] = handler;
      _middleware['OPTIONS'] = handlerOptions?.middleware || [];
      return api;
    },
    /**
     * Add a ALL route handler (typically to handle all HTTP methods)
     */
    all(handler: HS.RouteHandler, handlerOptions?: HS.RouteHandlerOptions) {
      _handlers['*'] = handler;
      _middleware['*'] = handlerOptions?.middleware || [];
      return api;
    },
    /**
     * Set a custom error handler for this route to fall back to if the route handler throws an error
     */
    errorHandler(handler: HS.ErrorHandler) {
      _errorHandler = handler;
      return api;
    },
    /**
     * Add a middleware function to this route (for all HTTP methods) (non-destructive)
     */
    use(middleware: HS.MiddlewareFunction) {
      _middleware['*'].push(middleware);
      return api;
    },
    /**
     * Set the complete middleware stack for this route (for all HTTP methods) (destructive)
     * NOTE: This will override the middleware stack for this route
     */
    middleware(middleware: Array<HS.MiddlewareFunction>) {
      _middleware['*'] = middleware;
      return api;
    },

    /**
     * Fetch - handle a direct HTTP request
     */
    async fetch(request: Request) {
      const context = createContext(request, api);
      const method = context.req.method;
      const globalMiddleware = _middleware['*'] || [];
      const methodMiddleware = _middleware[method] || [];

      const methodHandler = async (context: HS.Context) => {
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

        const handler = (method === 'HEAD' ? _handlers['GET'] : _handlers[method]) ?? _handlers['*'];

        if (!handler) {
          return context.res.error(new Error('Method not allowed'), { status: 405 });
        }

        // @TODO: Handle errors from route handler
        const routeContent = await handler(context);

        // Return Response if returned from route handler
        if (routeContent instanceof Response) {
          return routeContent;
        }

        if (isHTMLContent(routeContent)) {
          // Merge server and route-specific response options
          const responseOptions = { ...(api._serverConfig?.responseOptions ?? {}), ...(api._config?.responseOptions ?? {}) };
          return returnHTMLResponse(context, () => routeContent, responseOptions);
        }

        const contentType = _typeOf(routeContent);
        if (contentType === 'generator') {
          return new StreamResponse(routeContent as AsyncGenerator);
        }

        return routeContent;
      };

      // Run the route handler and any middleware
      // If an error occurs, run the error handler if it exists
      try {
        return await executeMiddleware(context, [...globalMiddleware, ...methodMiddleware, methodHandler]);
      } catch (e) {
        if (_errorHandler !== undefined) {
          const responseOptions = { ...(api._serverConfig?.responseOptions ?? {}), ...(api._config?.responseOptions ?? {}) };
          return returnHTMLResponse(context, () => (_errorHandler as HS.ErrorHandler)(context, e as Error), responseOptions);
        }
        throw e;
      }
    },
  };

  return api;
}

/**
 * Creates a server object that can compose routes and middleware
 */
export async function createServer(config: HS.Config = {} as HS.Config): Promise<HS.Server> {
  const _middleware: HS.MiddlewareFunction[] = [];
  const _routes: HS.Route[] = [];

  // Load plugins, if any
  if (config.plugins && config.plugins.length > 0) {
    await Promise.all(config.plugins.map(plugin => plugin(config)));
  }

  const api: HS.Server = {
    _config: config,
    _routes: _routes,
    _middleware: _middleware,
    use(middleware: HS.MiddlewareFunction) {
      _middleware.push(middleware);
      return this;
    },
    get(path: string, handler: HS.RouteHandler, handlerOptions?: HS.RouteHandlerOptions) {
      const route = createRoute().get(handler, handlerOptions);
      route._config.path = path;
      _routes.push(route);
      return route;
    },
    post(path: string, handler: HS.RouteHandler, handlerOptions?: HS.RouteHandlerOptions) {
      const route = createRoute().post(handler, handlerOptions);
      route._config.path = path;
      _routes.push(route);
      return route;
    },
    put(path: string, handler: HS.RouteHandler, handlerOptions?: HS.RouteHandlerOptions) {
      const route = createRoute().put(handler, handlerOptions);
      route._config.path = path;
      _routes.push(route);
      return route;
    },
    delete(path: string, handler: HS.RouteHandler, handlerOptions?: HS.RouteHandlerOptions) {
      const route = createRoute().delete(handler, handlerOptions);
      route._config.path = path;
      _routes.push(route);
      return route;
    },
    patch(path: string, handler: HS.RouteHandler, handlerOptions?: HS.RouteHandlerOptions) {
      const route = createRoute().patch(handler, handlerOptions);
      route._config.path = path;
      _routes.push(route);
      return route;
    },
    options(path: string, handler: HS.RouteHandler, handlerOptions?: HS.RouteHandlerOptions) {
      const route = createRoute().options(handler, handlerOptions);
      route._config.path = path;
      _routes.push(route);
      return route;
    },
    all(path: string, handler: HS.RouteHandler, handlerOptions?: HS.RouteHandlerOptions) {
      const route = createRoute().all(handler, handlerOptions);
      route._config.path = path;
      _routes.push(route);
      return route;
    },
  };

  return api;
}

/**
 * Checks if a response is HTML content
 */
function isHTMLContent(response: unknown): response is Response {
  const hasHTMLContentType = response instanceof Response && response.headers.get('Content-Type') === 'text/html';
  const isHTMLTemplate = isHSHtml(response);
  const isHTMLString = typeof response === 'string' && response.trim().startsWith('<');

  return hasHTMLContentType || isHTMLTemplate || isHTMLString;
}

/**
 * Return HTML response from userland route handler
 */
export async function returnHTMLResponse(
  context: HS.Context,
  handlerFn: () => unknown,
  responseOptions?: { status?: number; headers?: Record<string, string>; disableStreaming?: (context: HS.Context) => boolean }
): Promise<Response> {
  try {
    const routeContent = await handlerFn();

    // Return Response if returned from route handler
    if (routeContent instanceof Response) {
      return routeContent;
    }

    // Render HSHtml if returned from route handler
    if (isHSHtml(routeContent)) {
      const disableStreaming = responseOptions?.disableStreaming?.(context) ?? false;

      // Stream only if enabled and there is async content to stream
      if (!disableStreaming && (routeContent as HSHtml).asyncContent?.length > 0) {
        return new StreamResponse(
          renderStream(routeContent as HSHtml, {
            renderChunk: (chunk) => {
              return html`
              <template id="${chunk.id}_content">${html.raw(chunk.content)}<!--end--></template>
              <script>
                window._hsc = window._hsc || [];
                window._hsc.push({id: "${chunk.id}" });
              </script>
            `;
            }
          }),
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
export function getRunnableRoute(route: unknown, routeConfig?: HS.RouteConfig): HS.Route {
  // Runnable already? Just return it
  if (isRunnableRoute(route)) {
    return route as HS.Route;
  }

  const kind = typeof route;

  // Module - get default and use it
  // @ts-ignore
  if (kind === 'object' && 'default' in route) {
    return getRunnableRoute(route.default, routeConfig);
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

  const obj = route as { _kind: string; fetch: (request: Request) => Promise<Response> };
  return typeof obj?._kind === 'string' && 'fetch' in obj;
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
  if (err instanceof HTTPResponseException) {
    status = err._response?.status ?? 500;
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
