import type { Hyperspan as HS } from '@hyperspan/framework';
import type { ZodAny, ZodObject, ZodError } from 'zod/v4';
import { flattenError } from 'zod/v4';

export class ZodValidationError extends Error {
  constructor(flattened: ReturnType<typeof flattenError>) {
    super('Input validation error(s)');
    this.name = 'ZodValidationError';

    // Copy all properties from flattened error
    Object.assign(this, flattened);
  }
}

export function validateQuery(schema: ZodObject): HS.MiddlewareFunction {
  return async (context: HS.Context, next: HS.NextFunction) => {
    const query: Record<string, string> = Object.fromEntries(context.req.query.entries());
    const validated = schema.safeParse(query);

    if (!validated.success) {
      const err = formatZodError(validated.error);
      return context.res.error(err, { status: 400 });
    }

    return next();
  }
}

export function validateBody(schema: ZodObject | ZodAny): HS.MiddlewareFunction {
  return async (context: HS.Context, next: HS.NextFunction) => {
    const body = await context.req.body;
    const validated = schema.safeParse(body);

    if (!validated.success) {
      const err = formatZodError(validated.error);
      return context.res.error(err, { status: 400 });
    }

    return next();
  }
}

export function formatZodError(error: ZodError): ZodValidationError {
  const zodError = flattenError(error);
  return new ZodValidationError(zodError);
}