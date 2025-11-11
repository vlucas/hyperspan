import type { Hyperspan as HS } from './types';

/**
 * Type guard to check if a handler is a middleware function
 * Middleware functions have 2 parameters (context, next)
 * Route handlers have 1 parameter (context)
 */
function isMiddlewareFunction(
  handler: HS.MiddlewareFunction | HS.RouteHandler
): handler is HS.MiddlewareFunction {
  return handler.length === 2;
}

/**
 * Execute an array of middleware functions and route handlers
 * Middleware functions receive (context, next) and can call next() to continue
 * Route handlers receive (context) and are executed at the end of the chain
 * 
 * @param context - The Hyperspan context
 * @param handlers - Array of middleware functions and/or route handlers
 * @returns Promise<Response>
 */
export async function executeMiddleware(
  context: HS.Context,
  handlers: Array<HS.MiddlewareFunction | HS.RouteHandler>
): Promise<Response> {
  if (handlers.length === 0) {
    return context.res.notFound();
  }

  /**
   * Create the next function for middleware
   * This function will execute the next handler in the chain
   */
  const createNext = (index: number): HS.NextFunction => {
    return async (): Promise<Response> => {
      if (index >= handlers.length) {
        return context.res.notFound();
      }

      const handler = handlers[index];

      // If it's middleware, execute it with the next function
      if (isMiddlewareFunction(handler)) {
        const next = createNext(index + 1);
        const result = await handler(context, next);
        return result instanceof Response ? result : context.res.html(String(result));
      }

      // If it's a route handler, execute it and convert to Response
      return await handler(context) as Response;
    };
  };

  // Start execution from the first handler
  return await createNext(0)();
}

