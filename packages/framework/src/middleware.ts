import { formDataToJSON } from './utils';
import { z, flattenError } from 'zod/v4';

import type { ZodAny, ZodObject, ZodError } from 'zod/v4';
import type { Hyperspan as HS } from './types';
import { HTTPResponseException } from './server';

export type TValidationType = 'json' | 'form' | 'urlencoded';

/**
 * Infer the validation type from the request Content-Type header
 */
function inferValidationType(headers: Headers): TValidationType {
  const contentType = headers.get('content-type')?.toLowerCase() || '';

  if (contentType.includes('application/json')) {
    return 'json';
  } else if (contentType.includes('multipart/form-data')) {
    return 'form';
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    return 'urlencoded';
  }

  // Default to json if content-type is not recognized
  return 'json';
}

export class ZodValidationError extends Error {
  constructor(flattened: ReturnType<typeof flattenError>) {
    super('Input validation error(s)');
    this.name = 'ZodValidationError';

    // Copy all properties from flattened error
    Object.assign(this, flattened);
  }
}

export function validateQuery(schema: ZodObject | ZodAny): HS.MiddlewareFunction {
  return async (context: HS.Context, next: HS.NextFunction) => {
    const query = formDataToJSON(context.req.query);
    const validated = schema.safeParse(query);

    // Store the validated query in the context variables
    context.vars.query = validated.data as z.infer<typeof schema>;

    if (!validated.success) {
      const err = formatZodError(validated.error);
      return context.res.error(err, { status: 400 });
    }

    return next();
  }
}

export function validateBody(schema: ZodObject | ZodAny, type?: TValidationType): HS.MiddlewareFunction {
  return async (context: HS.Context, next: HS.NextFunction) => {
    // Infer type from Content-Type header if not provided
    const validationType = type || inferValidationType(context.req.headers);

    let body: unknown = {};
    if (validationType === 'json') {
      body = await context.req.raw.json();
    } else if (validationType === 'form') {
      const formData = await context.req.formData();
      body = formDataToJSON(formData as FormData);
    } else if (validationType === 'urlencoded') {
      const urlencoded = await context.req.urlencoded();
      body = formDataToJSON(urlencoded);
    }

    context.vars.body = body as z.infer<typeof schema>;
    const validated = schema.safeParse(body);

    if (!validated.success) {
      const err = formatZodError(validated.error);
      throw new HTTPResponseException(err, { status: 400 });
      //return context.res.error(err, { status: 400 });
    }

    return next();
  }
}

export function formatZodError(error: ZodError): ZodValidationError {
  const zodError = flattenError(error);
  return new ZodValidationError(zodError);
}

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
