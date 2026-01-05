import type { Hyperspan as HS } from '@hyperspan/framework';
import { formDataToJSON } from '@hyperspan/framework/utils';
import type { ZodAny, ZodObject, ZodError } from 'zod/v4';
import { z, flattenError } from 'zod/v4';

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

    if (!validated.success) {
      const err = formatZodError(validated.error);
      return context.res.error(err, { status: 400 });
    }

    // Store the validated query in the context variables
    context.vars.query = validated.data as z.infer<typeof schema>;

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
    const validated = schema.safeParse(body);

    if (!validated.success) {
      const err = formatZodError(validated.error);
      return context.res.error(err, { status: 400 });
    }

    // Store the validated body in the context variables
    context.vars.body = validated.data as z.infer<typeof schema>;

    return next();
  }
}

export function formatZodError(error: ZodError): ZodValidationError {
  const zodError = flattenError(error);
  return new ZodValidationError(zodError);
}