import { html, HSHtml } from '@hyperspan/html';
import { createRoute, IS_PROD, returnHTMLResponse } from './server';
import * as z from 'zod/v4';
import { assetHash } from './utils';
import type { Hyperspan as HS } from './types';

/**
 * Actions = Form + route handler
 * Automatically handles and parses form data
 *
 * HOW THIS WORKS:
 * ---
 * 1. Renders in any template as initial form markup with action.render()
 * 2. Binds form onSubmit function to custom client JS handling via <hs-action> web component
 * 3. Submits form with JavaScript fetch() + FormData as normal POST form submission
 * 4. All validation and save logic is run on the server
 * 5. Replaces form content in place with HTML response content from server via the Idiomorph library
 * 6. Handles any Exception thrown on server as error displayed back to user on the page
 */;
type HSActionResponse = HSHtml | void | null | Promise<HSHtml | void | null> | Response | Promise<Response>;
export interface HSAction<T extends z.ZodTypeAny> {
  _kind: string;
  _route: string;
  _form: (
    c: HS.Context,
    { data, error }: { data?: Partial<z.infer<T>>; error?: z.ZodError | Error }
  ) => HSActionResponse;
  post(
    handler: (
      c: HS.Context,
      { data }: { data?: Partial<z.infer<T>> }
    ) => HSActionResponse
  ): HSAction<T>;
  error(
    handler: (
      c: HS.Context,
      { data, error }: { data?: Partial<z.infer<T>>; error?: z.ZodError | Error }
    ) => HSActionResponse
  ): HSAction<T>;
  render(
    c: HS.Context,
    props?: { data?: Partial<z.infer<T>>; error?: z.ZodError | Error }
  ): HSActionResponse;
  middleware: (middleware: Array<HS.MiddlewareFunction>) => HSAction<T>;
  fetch(request: Request): Response | Promise<Response>;
}

export function createAction<T extends z.ZodTypeAny>(params: {
  schema?: T;
  form: HSAction<T>['_form'];
}) {
  const { schema, form } = params;

  let _handler: Parameters<HSAction<T>['post']>[0] | null = null;
  let _errorHandler: Parameters<HSAction<T>['error']>[0] | null = null;

  const route = createRoute()
    .get((c: HS.Context) => api.render(c))
    .post(async (c: HS.Context) => {
      // Parse form data
      const formData = await c.req.raw.formData();
      const jsonData = formDataToJSON(formData) as Partial<z.infer<T>>;
      const schemaData = schema ? schema.safeParse(jsonData) : null;
      const data = schemaData?.success ? (schemaData.data as Partial<z.infer<T>>) : jsonData;
      let error: z.ZodError | Error | null = null;

      try {
        if (schema && schemaData?.error) {
          throw schemaData.error;
        }

        if (!_handler) {
          throw new Error('Action POST handler not set! Every action must have a POST handler.');
        }

        const response = await _handler(c, { data });

        if (response instanceof Response) {
          // Replace redirects with special header because fetch() automatically follows redirects
          // and we want to redirect the user to the actual full page instead
          if ([301, 302, 307, 308].includes(response.status)) {
            response.headers.set('X-Redirect-Location', response.headers.get('Location') || '/');
            response.headers.delete('Location');
          }
        }

        return response;
      } catch (e) {
        error = e as Error | z.ZodError;
      }

      if (error && _errorHandler) {
        const errorHandler = _errorHandler; // Required for TypeScript to infer the correct type after narrowing
        return await returnHTMLResponse(c, () => errorHandler(c, { data, error }), {
          status: 400,
        });
      }

      return await returnHTMLResponse(c, () => api.render(c, { data, error }), { status: 400 });
    });

  const api: HSAction<T> = {
    _kind: 'hsAction',
    _route: `/__actions/${assetHash(form.toString())}`,
    _form: form,
    /**
     * Process form data
     *
     * Returns result from form processing if successful
     * Re-renders form with data and error information otherwise
     */
    post(handler) {
      _handler = handler;
      return api;
    },
    /**
     * Cusotm error handler if you want to display something other than the default
     */
    error(handler) {
      _errorHandler = handler;
      return api;
    },
    /**
     * Add middleware specific to this route
     */
    middleware(middleware) {
      route.middleware(middleware);
      return api;
    },
    /**
     * Get form renderer method
     */
    render(c: HS.Context, props?: { data?: Partial<z.infer<T>>; error?: z.ZodError | Error }) {
      const formContent = form ? form(c, props || {}) : null;
      return formContent ? html`<hs-action url="${this._route}">${formContent}</hs-action>` : null;
    },
    /**
     * Run action route handler
     */
    fetch(request: Request) {
      return route.fetch(request);
    },
  };

  return api;
}

/**
 * Return JSON data structure for a given FormData object
 * Accounts for array fields (e.g. name="options[]" or <select multiple>)
 *
 * @link https://stackoverflow.com/a/75406413
 */
export function formDataToJSON(formData: FormData): Record<string, string | string[]> {
  let object = {};

  /**
   * Parses FormData key xxx`[x][x][x]` fields into array
   */
  const parseKey = (key: string) => {
    const subKeyIdx = key.indexOf('[');

    if (subKeyIdx !== -1) {
      const keys = [key.substring(0, subKeyIdx)];
      key = key.substring(subKeyIdx);

      for (const match of key.matchAll(/\[(?<key>.*?)]/gm)) {
        if (match.groups) {
          keys.push(match.groups.key);
        }
      }
      return keys;
    } else {
      return [key];
    }
  };

  /**
   * Recursively iterates over keys and assigns key/values to object
   */
  const assign = (keys: string[], value: FormDataEntryValue, object: any): void => {
    const key = keys.shift();

    // When last key in the iterations
    if (key === '' || key === undefined) {
      return object.push(value);
    }

    if (Reflect.has(object, key)) {
      // If key has been found, but final pass - convert the value to array
      if (keys.length === 0) {
        if (!Array.isArray(object[key])) {
          object[key] = [object[key], value];
          return;
        }
      }
      // Recurse again with found object
      return assign(keys, value, object[key]);
    }

    // Create empty object for key, if next key is '' do array instead, otherwise set value
    if (keys.length >= 1) {
      object[key] = keys[0] === '' ? [] : {};
      return assign(keys, value, object[key]);
    } else {
      object[key] = value;
    }
  };

  for (const pair of formData.entries()) {
    assign(parseKey(pair[0]), pair[1], object);
  }

  return object;
}