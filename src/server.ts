import { readdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { html, renderToStream, renderToString } from './html';
import { isbot } from 'isbot';
import { HSApp, HSRequestContext, normalizePath } from './app';

export const IS_PROD = process.env.NODE_ENV === 'production';
const PWD = import.meta.dir;
const CWD = process.cwd();
const STATIC_FILE_MATCHER = /[^/\\&\?]+\.([a-zA-Z]+)$/;

/**
 * Did request come from a bot?
 */
function requestIsBot(req: Request) {
  const ua = req.headers.get('User-Agent');

  return ua ? isbot(ua) : false;
}

/**
 * Run route from file
 */
export async function runFileRoute(RouteModule: any, context: HSRequestContext) {
  const req = context.req;
  const url = new URL(req.url);
  const qs = url.searchParams;

  // @TODO: Move this to config or something...
  const streamOpt = qs.get('__nostream') ? !Boolean(qs.get('__nostream')) : undefined;
  const streamingEnabled = streamOpt !== undefined ? streamOpt : true;

  // Route module
  const RouteComponent = RouteModule.default;
  const reqMethod = req.method.toUpperCase();

  // Middleware?
  const routeMiddleware = RouteModule.middleware || {}; // Example: { auth: apiAuth, logger: logMiddleware, }
  const middlewareResult: Record<string, any> = {};

  try {
    // Run middleware if present...
    if (Object.keys(routeMiddleware).length) {
      for (const mKey in routeMiddleware) {
        const mRes = await routeMiddleware[mKey](context);

        if (mRes instanceof Response) {
          return context.responseMerge(mRes);
        }

        middlewareResult[mKey] = mRes;
      }
    }

    // API Route?
    if (RouteModule[reqMethod] !== undefined) {
      return await runAPIRoute(RouteModule[reqMethod], context, middlewareResult);
    }

    let routeContent;

    // No default export in this file...
    if (!RouteComponent) {
      throw new Error('No route was exported by default in matched route file.');
    }

    // Route component
    if (typeof RouteComponent._handlers !== 'undefined') {
      const routeMethodHandler = RouteComponent._handlers[reqMethod];

      if (!routeMethodHandler) {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { 'content-type': 'text/plain' },
        });
      }

      routeContent = await routeMethodHandler(context, middlewareResult);
    } else {
      routeContent = await RouteComponent(context, middlewareResult);
    }

    if (routeContent instanceof Response) {
      return context.responseMerge(routeContent);
    }

    if (streamingEnabled && !requestIsBot(req)) {
      return context.responseMerge(new StreamResponse(renderToStream(routeContent)) as Response);
    } else {
      // Render content and template
      // TODO: Use any context variables from RouteComponent rendering to set values in layout (dynamic title, etc.)...
      const output = await renderToString(routeContent);

      // Render it...
      return context.html(output);
    }
  } catch (e) {
    console.error(e);
    return await showErrorReponse(context, e as Error);
  }
}

/**
 * Run route and handle response
 */
async function runAPIRoute(routeFn: any, context: HSRequestContext, middlewareResult?: any) {
  try {
    return await routeFn(context, middlewareResult);
  } catch (err) {
    const e = err as Error;
    console.error(e);

    return context.json(
      {
        meta: { success: false },
        data: {
          message: e.message,
          stack: IS_PROD ? undefined : e.stack?.split('\n'),
        },
      },
      { status: 500 }
    );
  }
}

/**
 * Basic error handling
 * @TODO: Should check for and load user-customizeable template with special name (app/__error.ts ?)
 */
async function showErrorReponse(context: HSRequestContext, err: Error) {
  const output = await renderToString(html`
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
  // For customizing the routes and adding your own...
  beforeRoutesAdded?: (app: HSApp) => void;
  afterRoutesAdded?: (app: HSApp) => void;
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
      route = route.replace(ROUTE_SEGMENT, (match: string, p1: string, offset: number) => {
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
 * Create and start Bun HTTP server
 */
export async function createServer(config: THSServerConfig): Promise<HSApp> {
  // Build client JS and CSS bundles so they are available for templates when streaming starts
  await Promise.all([buildClientJS(), buildClientCSS()]);

  const app = new HSApp();

  app.defaultRoute(() => {
    return new Response('Not... found?', { status: 404 });
  });

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

    app.all(routePattern, async (context) => {
      const matchedRoute = await runFileRoute(routeModule, context);
      if (matchedRoute) {
        return matchedRoute as Response;
      }

      return app._defaultRoute(context);
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
  app.all('*', (context) => {
    const req = context.req;

    // Static files
    if (STATIC_FILE_MATCHER.test(req.url)) {
      const filePath = config.staticFileRoot + new URL(req.url).pathname;
      const file = Bun.file(filePath);
      let headers = {};

      if (IS_PROD) {
        headers = {
          'cache-control': 'public, max-age=31557600',
        };
      }

      return new Response(file, { headers });
    }

    return app._defaultRoute(context);
  });

  return app;
}

/**
 * Build client JS for end users (minimal JS for Hyperspan to work)
 */
export let clientJSFile: string;
export async function buildClientJS() {
  const sourceFile = resolve(PWD, '../', './src/clientjs/hyperspan-client.ts');
  const output = await Bun.build({
    entrypoints: [sourceFile],
    outdir: `./public/_hs/js`,
    naming: IS_PROD ? '[dir]/[name]-[hash].[ext]' : undefined,
    minify: IS_PROD,
  });

  clientJSFile = output.outputs[0].path.split('/').reverse()[0];
  return clientJSFile;
}

/**
 * Find client CSS file built for end users
 * @TODO: Build this in code here vs. relying on tailwindcss CLI tool from package scripts
 */
export let clientCSSFile: string;
export async function buildClientCSS() {
  if (clientCSSFile) {
    return clientCSSFile;
  }

  // Find file already built from tailwindcss CLI
  const cssDir = './public/_hs/css/';
  const cssFiles = await readdir(cssDir);

  for (const file of cssFiles) {
    // Only looking for CSS files
    if (clientCSSFile || !file.endsWith('.css')) {
      continue;
    }

    return (clientCSSFile = file.replace(cssDir, ''));
  }

  if (!clientCSSFile) {
    throw new Error(`Unable to build CSS files from ${cssDir}`);
  }
}

/**
 * Streaming HTML Response
 */
export class StreamResponse {
  constructor(iterator: AsyncIterator<unknown>, options = {}) {
    const stream = createReadableStreamFromAsyncGenerator(iterator as AsyncGenerator);

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Transfer-Encoding': 'chunked',
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
