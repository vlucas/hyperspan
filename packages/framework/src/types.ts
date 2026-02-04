import { HSHtml } from '@hyperspan/html';
import * as z from 'zod/v4';

/**
 * Hyperspan Types
 */
export namespace Hyperspan {
  export interface Server {
    _config: Hyperspan.Config;
    _routes: Array<Hyperspan.Route>;
    _middleware: Record<Hyperspan.MiddlewareMethod, Array<Hyperspan.MiddlewareFunction>>;
    use: (middleware: Hyperspan.MiddlewareFunction, opts?: Hyperspan.MiddlewareMethodOptions) => Hyperspan.Server;
    get: (path: string, handler: Hyperspan.RouteHandler, handlerOptions?: Hyperspan.RouteHandlerOptions) => Hyperspan.Route;
    post: (path: string, handler: Hyperspan.RouteHandler, handlerOptions?: Hyperspan.RouteHandlerOptions) => Hyperspan.Route;
    put: (path: string, handler: Hyperspan.RouteHandler, handlerOptions?: Hyperspan.RouteHandlerOptions) => Hyperspan.Route;
    patch: (path: string, handler: Hyperspan.RouteHandler, handlerOptions?: Hyperspan.RouteHandlerOptions) => Hyperspan.Route;
    delete: (path: string, handler: Hyperspan.RouteHandler, handlerOptions?: Hyperspan.RouteHandlerOptions) => Hyperspan.Route;
    options: (path: string, handler: Hyperspan.RouteHandler, handlerOptions?: Hyperspan.RouteHandlerOptions) => Hyperspan.Route;
    all: (path: string, handler: Hyperspan.RouteHandler, handlerOptions?: Hyperspan.RouteHandlerOptions) => Hyperspan.Route;
  };

  export type Plugin = (config: Hyperspan.Config) => Promise<void> | void;

  export type Config = {
    appDir: string;
    publicDir: string;
    plugins: Array<Hyperspan.Plugin>; // Loaders for client islands
    // For customizing the routes and adding your own...
    beforeRoutesAdded?: (server: Hyperspan.Server) => void;
    afterRoutesAdded?: (server: Hyperspan.Server) => void;
    responseOptions?: {
      disableStreaming?: (context: Hyperspan.Context) => boolean;
    };
  };

  export type CookieOptions = {
    maxAge?: number;
    domain?: string;
    path?: string;
    expires?: Date;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'lax' | 'strict' | true;
  };
  export type Cookies = {
    _req: Request;
    _responseHeaders: Headers | undefined;
    _parsedCookies: Record<string, any>;
    _encrypt: ((str: string) => string) | undefined;
    _decrypt: ((str: string) => string) | undefined;
    get: (name: string) => string | undefined;
    set: (name: string, value: string, options?: CookieOptions) => void;
    delete: (name: string) => void;
  }

  export type HSRequest = {
    url: URL;
    raw: Request;
    method: string; // Always uppercase
    headers: Headers; // Case-insensitive
    query: URLSearchParams;
    cookies: Hyperspan.Cookies;
    text: () => Promise<string>;
    json<T = unknown>(): Promise<T>;
    formData(): Promise<FormData>;
    urlencoded(): Promise<URLSearchParams>;
  };

  export type HSResponse = {
    cookies: Hyperspan.Cookies;
    headers: Headers; // Headers to merge with final outgoing response
    status: number | undefined;
    html: (html: string, options?: ResponseInit) => Promise<Response>;
    json: (json: any, options?: ResponseInit) => Promise<Response>;
    text: (text: string, options?: ResponseInit) => Promise<Response>;
    redirect: (url: string, options?: ResponseInit) => Promise<Response>;
    error: (error: Error, options?: ResponseInit) => Promise<Response>;
    notFound: (options?: ResponseInit) => Promise<Response>;
    merge: (response: Response) => Promise<Response>;
  };

  export interface Context {
    vars: Record<string, any>;
    route: RouteConfig;
    req: HSRequest;
    res: HSResponse;
  };

  export type ClientIslandOptions = {
    ssr?: boolean;
    loading?: 'lazy' | undefined;
  };

  export type RouteConfig = {
    name: string | undefined;
    path: string;
    params: Record<string, string | undefined>;
    cssImports: string[];
    responseOptions?: {
      disableStreaming?: (context: Hyperspan.Context) => boolean;
    };
  };
  export type RouteHandler = (context: Hyperspan.Context) => unknown;
  export type RouteHandlerOptions = {
    middleware?: Hyperspan.MiddlewareFunction[];
  }

  // TypeScript inference for typed   route params
  // Source - https://stackoverflow.com/a/78170543
  // Posted by jcalz
  // Retrieved 2025-11-12, License - CC BY-SA 4.0
  export type RouteParamsParser<T extends string, A = unknown> =
    T extends `${string}:${infer F}/${infer R}` ? RouteParamsParser<R, A & Record<F, string>> :
    (A & (T extends `${string}:${infer F}` ? Record<F, string> : unknown)) extends
    infer U ? { [K in keyof U]: U[K] } : never


  /**
   * Next function type for middleware
   */
  export type NextFunction = () => Promise<Response>;

  /**
   * Error handler function signature
   */
  export type ErrorHandler = (context: Hyperspan.Context, error: Error) => unknown | undefined;

  /**
   * Middleware function signature
   * Accepts context and next function, returns a Response
   */
  export type MiddlewareFunction = (
    context: Hyperspan.Context,
    next: Hyperspan.NextFunction
  ) => Promise<Response> | Response;
  export type MiddlewareMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | '*';
  export type MiddlewareMethodOptions = {
    method?: Hyperspan.MiddlewareMethod;
  };

  export interface Route {
    _kind: 'hsRoute';
    _config: Partial<Hyperspan.RouteConfig>;
    _serverConfig?: Hyperspan.Config;
    _middleware: Record<MiddlewareMethod, Array<Hyperspan.MiddlewareFunction>>;
    _path(): string;
    _methods(): string[];
    get: (handler: Hyperspan.RouteHandler, handlerOptions?: Hyperspan.RouteHandlerOptions) => Hyperspan.Route;
    post: (handler: Hyperspan.RouteHandler, handlerOptions?: Hyperspan.RouteHandlerOptions) => Hyperspan.Route;
    put: (handler: Hyperspan.RouteHandler, handlerOptions?: Hyperspan.RouteHandlerOptions) => Hyperspan.Route;
    patch: (handler: Hyperspan.RouteHandler, handlerOptions?: Hyperspan.RouteHandlerOptions) => Hyperspan.Route;
    delete: (handler: Hyperspan.RouteHandler, handlerOptions?: Hyperspan.RouteHandlerOptions) => Hyperspan.Route;
    options: (handler: Hyperspan.RouteHandler, handlerOptions?: Hyperspan.RouteHandlerOptions) => Hyperspan.Route;
    all: (handler: Hyperspan.RouteHandler, handlerOptions?: Hyperspan.RouteHandlerOptions) => Hyperspan.Route;
    errorHandler: (handler: Hyperspan.ErrorHandler) => Hyperspan.Route;
    use: (middleware: Hyperspan.MiddlewareFunction, opts?: Hyperspan.MiddlewareMethodOptions) => Hyperspan.Route;
    middleware: (middleware: Array<Hyperspan.MiddlewareFunction>, opts?: Hyperspan.MiddlewareMethodOptions) => Hyperspan.Route;
    fetch: (request: Request) => Promise<Response>;
  };

  /**
   * Action = Form + route handler
   */
  // Form renderer
  export type ActionFormResponse = HSHtml | void | null | Promise<HSHtml | void | null>;
  export type ActionFormProps<T extends z.ZodTypeAny> = { data?: Partial<z.infer<T>>; error?: ZodValidationError };
  export type ActionForm<T extends z.ZodTypeAny> = (
    c: Context, props: ActionFormProps<T>
  ) => ActionFormResponse;
  // Form handler
  export type ActionFormHandlerResponse = ActionFormResponse | Response | Promise<Response>;
  export type ActionFormHandlerProps<T extends z.ZodTypeAny> = { data: z.infer<T>; error?: ZodValidationError | Error };
  export type ActionFormHandler<T extends z.ZodTypeAny> = (
    c: Context, props: ActionFormHandlerProps<T>
  ) => ActionFormHandlerResponse;
  // Action API
  export interface Action<T extends z.ZodTypeAny> {
    _kind: 'hsAction';
    _config: Partial<Hyperspan.RouteConfig>;
    _path(): string;
    _form: null | ActionForm<T>;
    form(form: ActionForm<T>): Action<T>;
    render: (c: Context, props?: ActionFormProps<T>) => ActionFormResponse;
    post: (handler: ActionFormHandler<T>) => Action<T>;
    errorHandler: (handler: ActionFormHandler<T>) => Action<T>;
    use: (middleware: Hyperspan.MiddlewareFunction, opts?: Hyperspan.MiddlewareMethodOptions) => Action<T>;
    middleware: (middleware: Array<Hyperspan.MiddlewareFunction>, opts?: Hyperspan.MiddlewareMethodOptions) => Action<T>;
    fetch: (request: Request) => Promise<Response>;
  }

  /**
   * Client JS Module = ESM Module + Public Path + Render Script Tag
   */
  export type ClientJSBuildResult = {
    assetHash: string; // Asset hash of the module path
    esmName: string; // Filename of the built JavaScript file without the extension
    publicPath: string; // Full public path of the built JavaScript file
    /**
     * Render a <script type="module"> tag for the JS module
     * @param loadScript - A function that loads the module or a string of code to load the module
     * @returns HSHtml Template with the <script type="module"> tag
     */
    renderScriptTag: (loadScript?: ((module: unknown) => HSHtml | string | void) | string) => HSHtml;
  }

  /**
   * Zod validation error type. Used in actions and validation middleware.
   */
  export interface ZodValidationError extends Error {
    fieldErrors: Record<string, string[] | undefined>;
    formErrors: unknown[];
  }
}
