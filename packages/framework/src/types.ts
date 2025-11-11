/**
 * Hyperspan Types
 */
export namespace Hyperspan {
  export type App = {};

  export type Config = {
    appDir: string;
    staticFileRoot: string;
    rewrites?: Array<{ source: string; destination: string }>;
    islandPlugins?: Array<any>; // Loaders for client islands
    // For customizing the routes and adding your own...
    beforeRoutesAdded?: (app: Hyperspan.App) => void;
    afterRoutesAdded?: (app: Hyperspan.App) => void;
  };

  export type Context = {
    req: {
      url: URL;
      raw: Request;
      method: string; // Always uppercase
      headers: Headers; // Case-insensitive
      query: URLSearchParams;
      params: Map<string, string>;
      body: any;
    };
    res: {
      html: (html: string, options?: { status?: number; headers?: Record<string, string> }) => Response
      json: (json: any, options?: { status?: number; headers?: Record<string, string> }) => Response;
      text: (text: string, options?: { status?: number; headers?: Record<string, string> }) => Response;
      redirect: (url: string, options?: { status?: number; headers?: Record<string, string> }) => Response;
      error: (error: Error, options?: { status?: number; headers?: Record<string, string> }) => Response;
      notFound: (options?: { status?: number; headers?: Record<string, string> }) => Response;
      raw: Response;
    };
  };

  export type RouteHandler = (context: Hyperspan.Context) => unknown;

  /**
   * Next function type for middleware
   */
  export type NextFunction = () => Promise<Response>;

  /**
   * Middleware function signature
   * Accepts context and next function, returns a Response
   */
  export type MiddlewareFunction = (
    context: Hyperspan.Context,
    next: Hyperspan.NextFunction
  ) => Promise<Response> | Response;

  export type Route = {
    _kind: 'hsRoute';
    _name: string | undefined;
    _path: string | undefined;
    _methods: () => string[];
    get: (handler: Hyperspan.RouteHandler) => Hyperspan.Route;
    post: (handler: Hyperspan.RouteHandler) => Hyperspan.Route;
    put: (handler: Hyperspan.RouteHandler) => Hyperspan.Route;
    delete: (handler: Hyperspan.RouteHandler) => Hyperspan.Route;
    patch: (handler: Hyperspan.RouteHandler) => Hyperspan.Route;
    options: (handler: Hyperspan.RouteHandler) => Hyperspan.Route;
    middleware: (middleware: Array<Hyperspan.MiddlewareHandler>) => Hyperspan.Route;
    _getRouteHandlers: () => Array<Hyperspan.MiddlewareHandler | Hyperspan.RouteHandler>;
    fetch: (request: Request) => Promise<Response>;
  };

  export type MiddlewareHandler = (context: Hyperspan.Context) => Hyperspan.RouteHandler;
}
