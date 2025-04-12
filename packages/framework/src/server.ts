import { readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { TmplHtml, html, renderStream, renderAsync, render } from '@hyperspan/html';
import { isbot } from 'isbot';
import { buildClientJS, buildClientCSS } from './assets';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import type { Context, Handler } from 'hono';

import * as v from 'valibot';
import type {
  AnySchema,
  ArraySchema,
  BigintSchema,
  BooleanSchema,
  DateSchema,
  EnumSchema,
  GenericIssue,
  IntersectSchema,
  LazySchema,
  LiteralSchema,
  NullSchema,
  NullableSchema,
  NullishSchema,
  NumberSchema,
  ObjectSchema,
  ObjectWithRestSchema,
  OptionalSchema,
  PicklistSchema,
  PipeItem,
  RecordSchema,
  SchemaWithPipe,
  StrictObjectSchema,
  StrictTupleSchema,
  StringSchema,
  TupleSchema,
  TupleWithRestSchema,
  UndefinedSchema,
  UnionSchema,
  VariantSchema,
} from 'valibot';

export const IS_PROD = process.env.NODE_ENV === 'production';
const PWD = import.meta.dir;
const CWD = process.cwd();

type NonPipeSchemas =
  | AnySchema
  | LiteralSchema<any, any>
  | NullSchema<any>
  | NumberSchema<any>
  | BigintSchema<any>
  | StringSchema<any>
  | BooleanSchema<any>
  | NullableSchema<any, any>
  | StrictObjectSchema<any, any>
  | ObjectSchema<any, any>
  | ObjectWithRestSchema<any, any, any>
  | RecordSchema<any, any, any>
  | ArraySchema<any, any>
  | TupleSchema<any, any>
  | StrictTupleSchema<any, any>
  | TupleWithRestSchema<readonly any[], any, any>
  | IntersectSchema<any, any>
  | UnionSchema<any, any>
  | VariantSchema<any, any, any>
  | PicklistSchema<any, any>
  | EnumSchema<any, any>
  | LazySchema<any>
  | DateSchema<any>
  | NullishSchema<any, any>
  | OptionalSchema<any, any>
  | UndefinedSchema<any>;

type PipeSchema = SchemaWithPipe<[NonPipeSchemas, ...PipeItem<any, any, GenericIssue<any>>[]]>;
// Type inference for valibot taken from:
// @link https://github.com/gcornut/valibot-json-schema/blob/main/src/toJSONSchema/schemas.ts
export type TSupportedSchema = NonPipeSchemas | PipeSchema;

/**
 * ===========================================================================
 */

/**
 * Route
 * Define a route that can handle a direct HTTP request
 * Route handlers should return a Response or TmplHtml object
 */
export function createRoute(handler: Handler): HSRoute {
  return new HSRoute(handler);
}

/**
 * Component
 * Define a component or partial with an optional loading placeholder
 * These can be rendered anywhere inside other templates - even if async.
 */
export function createComponent(render: () => THSComponentReturn | Promise<THSComponentReturn>) {
  return new HSComponent(render);
}

/**
 * Form + route handler
 * Automatically handles and parses form data
 *
 * INITIAL IDEA OF HOW THIS WILL WORK:
 * ---
 * 1. Renders component as initial form markup for GET request
 * 2. Bind form onSubmit function to custom client JS handling
 * 3. Submits form with JavaScript fetch()
 * 4. Replaces form content with content from server
 * 5. All validation and save logic is on the server
 * 6. Handles any Exception thrown on server as error displayed in client
 */
export function createForm(
  renderForm: (data?: any) => THSResponseTypes,
  schema?: TSupportedSchema | null
): HSFormRoute {
  return new HSFormRoute(renderForm, schema);
}

/**
 * Types
 */
export type THSComponentReturn = TmplHtml | string | number | null;
export type THSResponseTypes = TmplHtml | Response | string | null;
export const HS_DEFAULT_LOADING = () => html`<div>Loading...</div>`;

/**
 * Route handler helper
 */
export class HSComponent {
  _kind = 'hsComponent';
  _handlers: Record<string, Handler> = {};
  _loading?: () => TmplHtml;
  render: () => THSComponentReturn | Promise<THSComponentReturn>;
  constructor(render: () => THSComponentReturn | Promise<THSComponentReturn>) {
    this.render = render;
  }

  loading(fn: () => TmplHtml) {
    this._loading = fn;
    return this;
  }
}

/**
 * Route handler helper
 */
export class HSRoute {
  _kind = 'hsRoute';
  _handlers: Record<string, Handler> = {};
  _methods: null | string[] = null;
  constructor(handler: Handler) {
    this._handlers.GET = handler;
  }
}

/**
 * Form route handler helper
 */
export type THSFormRenderer = (data?: any) => THSResponseTypes;
export class HSFormRoute {
  _kind = 'hsFormRoute';
  _handlers: Record<string, Handler> = {};
  _form: THSFormRenderer;
  _methods: null | string[] = null;
  _schema: null | TSupportedSchema = null;

  constructor(renderForm: THSFormRenderer, schema: TSupportedSchema | null = null) {
    // Haz schema?
    if (schema) {
      type TSchema = v.InferInput<typeof schema>;
      this._form = renderForm as (data: TSchema) => THSResponseTypes;
      this._schema = schema;
    } else {
      this._form = renderForm;
    }

    // GET request is render form by default
    this._handlers.GET = (ctx: Context) => renderForm(this.getDefaultData());
  }

  // Form data
  getDefaultData() {
    if (!this._schema) {
      return {};
    }

    type TSchema = v.InferInput<typeof this._schema>;
    const data = v.parse(this._schema, {});
    return data as TSchema;
  }

  /**
   * Get form renderer method
   */
  renderForm(data?: any) {
    return this._form(data || this.getDefaultData());
  }

  // HTTP handlers
  get(handler: Handler) {
    this._handlers.GET = handler;
    return this;
  }

  patch(handler: Handler) {
    this._handlers.PATCH = handler;
    return this;
  }

  post(handler: Handler) {
    this._handlers.POST = handler;
    return this;
  }

  put(handler: Handler) {
    this._handlers.PUT = handler;
    return this;
  }

  delete(handler: Handler) {
    this._handlers.DELETE = handler;
    return this;
  }
}

/**
 * Run route from file
 */
export async function runFileRoute(RouteModule: any, context: Context): Promise<Response | false> {
  const req = context.req;
  const url = new URL(req.url);
  const qs = url.searchParams;

  // @TODO: Move this to config or something...
  const userIsBot = isbot(context.req.header('User-Agent'));
  const streamOpt = qs.get('__nostream') ? !Boolean(qs.get('__nostream')) : undefined;
  const streamingEnabled = !userIsBot && (streamOpt !== undefined ? streamOpt : true);

  // Route module
  const RouteComponent = RouteModule.default;
  const reqMethod = req.method.toUpperCase();

  try {
    // API Route?
    if (RouteModule[reqMethod] !== undefined) {
      return await runAPIRoute(RouteModule[reqMethod], context);
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

      routeContent = await routeMethodHandler(context);
    } else {
      routeContent = await RouteComponent(context);
    }

    if (routeContent instanceof Response) {
      return routeContent;
    }

    // Render TmplHtml if returned from route handler
    if (routeContent instanceof TmplHtml) {
      if (streamingEnabled) {
        return new StreamResponse(renderStream(routeContent)) as Response;
      } else {
        const output = await renderAsync(routeContent);
        return context.html(output);
      }
    }

    return routeContent;
  } catch (e) {
    console.error(e);
    return await showErrorReponse(context, e as Error);
  }
}

/**
 * Run route and handle response
 */
async function runAPIRoute(routeFn: any, context: Context, middlewareResult?: any) {
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

    app.all(routePattern, async (context) => {
      const matchedRoute = await runFileRoute(routeModule, context);
      if (matchedRoute) {
        return matchedRoute as Response;
      }

      return context.notFound();
    });
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
