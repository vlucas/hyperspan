/**
 * Hyperspan Types
 */
export namespace Hyperspan {
  export interface Server {
    _config: Hyperspan.Config;
    _routes: Array<Hyperspan.Route>;
    _middleware: Array<Hyperspan.MiddlewareHandler>;
    use: (middleware: Hyperspan.MiddlewareHandler) => Hyperspan.Server;
    get: (path: string, handler: Hyperspan.RouteHandler) => Hyperspan.Route;
    post: (path: string, handler: Hyperspan.RouteHandler) => Hyperspan.Route;
    put: (path: string, handler: Hyperspan.RouteHandler) => Hyperspan.Route;
    delete: (path: string, handler: Hyperspan.RouteHandler) => Hyperspan.Route;
    patch: (path: string, handler: Hyperspan.RouteHandler) => Hyperspan.Route;
  };

  export type Config = {
    appDir: string;
    staticFileRoot: string;
    islandPlugins?: Array<any>; // Loaders for client islands
    // For customizing the routes and adding your own...
    beforeRoutesAdded?: (server: Hyperspan.Server) => void;
    afterRoutesAdded?: (server: Hyperspan.Server) => void;
  };

  export interface Context {
    route: {
      path: string;
      params: Record<string, string>;
    }
    req: {
      url: URL;
      raw: Request;
      method: string; // Always uppercase
      headers: Headers; // Case-insensitive
      query: URLSearchParams;
      params: Record<string, string>;
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

  export type RouteConfig = {
    name?: string;
    path?: string;
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

  export interface Route {
    _kind: 'hsRoute';
    _name: string | undefined;
    _config: Hyperspan.RouteConfig;
    _path(): string;
    _methods(): string[];
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
