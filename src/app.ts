// @ts-ignore
import Router from 'trek-router';
// @ts-ignore
import Middleware from 'trek-middleware';
import deepmerge from '@fastify/deepmerge';
import Headers from '@mjackson/headers';
import { HSTemplate } from './html';
import { html } from './html';
import type { ZodSchema } from 'zod';

const mergeAll = deepmerge({ all: true });

type THTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Request context
 */
export class HSRequestContext {
  public req: Request;
  public locals: Record<string, any>;
  public headers: Headers;
  public route: {
    params: Record<string, string>;
    query: URLSearchParams;
  };

  constructor(req: Request, params: Record<string, string> = {}) {
    this.req = req;
    this.locals = {};
    this.route = {
      params,
      query: new URL(req.url).searchParams,
    };

    // This could probably be re-visited...
    const allowHeaders = ['cookie'];
    const reqHeaders: Record<string, string> = {};

    for (let [name, value] of req.headers) {
      if (allowHeaders.includes(name)) {
        reqHeaders[name] = value;
      }
    }

    this.headers = new Headers(reqHeaders);
  }

  /**
   * Response helper
   * Merges a Response object while preserving all headers added in context/middleware
   */
  responseMerge(res: Response) {
    const cHeaders: Record<string, string> = {};
    for (let [name, value] of this.headers) {
      cHeaders[name] = value;
    }

    const newRes = new Response(
      res.body,
      mergeAll(
        { headers: cHeaders },
        { headers: res.headers.toJSON() },
        { status: res.status, statusText: res.statusText }
      )
    );

    return newRes;
  }

  /**
   * HTML response helper
   * Preserves all headers added in context/middleware
   */
  html(content: string, options?: ResponseInit): Response {
    return new Response(content, mergeAll({ headers: { 'Content-Type': 'text/html' } }, options));
  }

  /**
   * JSON response helper
   * Preserves all headers added in context/middleware
   */
  json(content: any, options?: ResponseInit): Response {
    return new Response(
      JSON.stringify(content),
      mergeAll({ headers: { 'Content-Type': 'application/json' } }, options)
    );
  }

  notFound(msg: string = 'Not found!') {
    return this.html(msg, { status: 404 });
  }
}

/**
 * Types
 */
export type THSComponentReturn = HSTemplate | string | number | null;
export type THSResponseTypes = HSTemplate | Response | string | null;
export type THSRouteHandler = (
  context: HSRequestContext,
  middlewareResult?: Record<string, any> // @TODO: Move this to context...
) => THSResponseTypes | Promise<THSResponseTypes>;
export type THSFormRouteHandler = (
  context: HSRequestContext,
  formData?: Record<string, any> // Parsed data from 'formData' object or query string w/input validation
) => THSResponseTypes | Promise<THSResponseTypes>;
export type THSRouteHandlerNonAsync = (context: HSRequestContext) => THSResponseTypes;
export const HS_DEFAULT_LOADING = () => html`<div>Loading...</div>`;

/**
 * Route handler helper
 */
export class HSRoute {
  _kind = 'hsRoute';
  _handler: THSRouteHandler;
  _methods: null | string[] = null;
  constructor(handler: THSRouteHandler) {
    this._handler = handler;
  }
}

/**
 * Form route handler helper
 */
export class HSFormRoute {
  _kind = 'hsFormRoute';
  _handler: THSRouteHandler;
  _methods: null | string[] = null;
  _input: null | ZodSchema = null;
  constructor(handler: THSRouteHandler) {
    this._handler = handler;
  }

  input(schema: ZodSchema) {
    this._input = schema;
  }

  get(ctx: HSRequestContext) {
    return this._handler(ctx);
  }

  post(ctx: HSRequestContext) {
    return ctx.responseMerge(new Response('Method not allowed', { status: 405 }));
  }
}

/**
 * Component helper
 */
export type THSComponentFn = (...args: any[]) => THSComponentReturn;
export class HSComponent {
  _kind = 'hsComponent';
  _handler: THSComponentFn;
  _loader: THSComponentFn = HS_DEFAULT_LOADING;
  constructor(handler: THSComponentFn) {
    this._handler = handler;
  }

  loading(fn: THSComponentFn): HSComponent {
    this._loader = fn;
    return this;
  }
}

/**
 * App
 */
export class HSApp {
  private _router: typeof Router;
  private _mw: typeof Middleware;
  public _defaultRoute: THSRouteHandler;

  constructor() {
    this._router = new Router();
    this._mw = new Middleware();
    this._defaultRoute = (c: HSRequestContext) => {
      return c.notFound('Not found');
    };
  }

  // @TODO: Middleware !!!!

  public get(path: string, handler: THSRouteHandler) {
    return this._route('GET', path, handler);
  }
  public post(path: string, handler: THSRouteHandler) {
    return this._route('POST', path, handler);
  }
  public put(path: string, handler: THSRouteHandler) {
    return this._route('PUT', path, handler);
  }
  public delete(path: string, handler: THSRouteHandler) {
    return this._route('DELETE', path, handler);
  }
  public all(path: string, handler: THSRouteHandler) {
    return this.addRoute(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], path, handler);
  }
  public addRoute(methods: THTTPMethod[], path: string, handler: THSRouteHandler) {
    methods.forEach((method) => {
      this._route(method, path, handler);
    });
    return this;
  }
  public defaultRoute(handler: THSRouteHandler) {
    this._defaultRoute = handler;
  }
  private _route(method: string | string[], path: string, handler: any) {
    this._router.add(method, path, handler);
    return this;
  }

  async run(req: Request): Promise<Response> {
    let response: THSResponseTypes = null;
    let url = new URL(req.url);
    let urlPath = normalizePath(url.pathname);

    // Redirect to normalized path (lowercase & without trailing slash)
    if (urlPath !== url.pathname) {
      url.pathname = urlPath;
      return Response.redirect(url);
    }

    let result = this._router.find(req.method.toUpperCase(), urlPath);
    let params: Record<string, any> = {};

    if (result && result[0]) {
      // Build params
      result[1].forEach((param: any) => (params[param.name] = param.value));

      // Run route with context + params
      const context = new HSRequestContext(req, params);
      response = result[0](context);
    }

    if (response) {
      // @ts-ignore
      return response;
    }

    const context = new HSRequestContext(req);

    // @ts-ignore
    return this._defaultRoute(context);
  }
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
