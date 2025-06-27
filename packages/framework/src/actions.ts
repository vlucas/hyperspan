import { html, HSHtml } from '@hyperspan/html';
import * as z from 'zod/v4';
import { HTTPException } from 'hono/http-exception';

import { IS_PROD, returnHTMLResponse, type THSResponseTypes } from './server';
import type { Context, MiddlewareHandler } from 'hono';
import type { HandlerResponse, Next, TypedResponse } from 'hono/types';
import { assetHash } from './assets';

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
 */
type TActionResponse = THSResponseTypes | HandlerResponse<any> | TypedResponse<any, any, any>;
export interface HSAction<T extends z.ZodTypeAny> {
  _kind: string;
  _route: string;
  _form: Parameters<HSAction<T>['form']>[0];
  form(
    renderForm: ({ data, error }: { data?: z.infer<T>; error?: z.ZodError | Error }) => HSHtml
  ): HSAction<T>;
  post(
    handler: (
      c: Context<any, any, {}>,
      { data }: { data?: z.infer<T> }
    ) => TActionResponse | Promise<TActionResponse>
  ): HSAction<T>;
  error(
    handler: (
      c: Context<any, any, {}>,
      { data, error }: { data?: z.infer<T>; error?: z.ZodError | Error }
    ) => TActionResponse
  ): HSAction<T>;
  render(props?: { data?: z.infer<T>; error?: z.ZodError | Error }): TActionResponse;
  run(c: Context<any, any, {}>): TActionResponse | Promise<TActionResponse>;
  middleware: (
    middleware: Array<
      | MiddlewareHandler
      | ((context: Context<any, string, {}>) => TActionResponse | Promise<TActionResponse>)
    >
  ) => HSAction<T>;
  _getRouteHandlers: () => Array<
    | MiddlewareHandler
    | ((context: Context, next: Next) => TActionResponse | Promise<TActionResponse>)
    | ((context: Context) => TActionResponse | Promise<TActionResponse>)
  >;
}

export function unstable__createAction<T extends z.ZodTypeAny>(
  schema: T | null = null,
  form: Parameters<HSAction<T>['form']>[0]
) {
  let _handler: Parameters<HSAction<T>['post']>[0] | null = null,
    _form: Parameters<HSAction<T>['form']>[0] = form,
    _errorHandler: Parameters<HSAction<T>['error']>[0] | null = null,
    _middleware: Array<
      | MiddlewareHandler
      | ((context: Context, next: Next) => TActionResponse | Promise<TActionResponse>)
      | ((context: Context) => TActionResponse | Promise<TActionResponse>)
    > = [];

  const api: HSAction<T> = {
    _kind: 'hsAction',
    _route: `/__actions/${assetHash(_form.toString())}`,
    _form,
    form(renderForm) {
      _form = renderForm;
      return api;
    },
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
      _middleware = middleware;
      return api;
    },
    /**
     * Get form renderer method
     */
    render(formState?: { data?: z.infer<T>; error?: z.ZodError | Error }) {
      const form = _form ? _form(formState || {}) : null;
      return form ? html`<hs-action url="${this._route}">${form}</hs-action>` : null;
    },

    _getRouteHandlers() {
      return [
        ..._middleware,
        async (c: Context) => {
          const response = await returnHTMLResponse(c, () => api.run(c));

          // Replace redirects with special header because fetch() automatically follows redirects
          // and we want to redirect the user to the actual full page instead
          if ([301, 302, 307, 308].includes(response.status)) {
            response.headers.set('X-Redirect-Location', response.headers.get('Location') || '/');
            response.headers.delete('Location');
          }

          return response;
        },
      ];
    },

    /**
     * Run action
     *
     * Returns result from form processing if successful
     * Re-renders form with data and error information otherwise
     */
    async run(c) {
      const method = c.req.method;

      if (method === 'GET') {
        return await api.render();
      }

      if (method !== 'POST') {
        throw new HTTPException(405, { message: 'Actions only support GET and POST requests' });
      }

      const formData = await c.req.formData();
      const jsonData = unstable__formDataToJSON(formData);
      const schemaData = schema ? schema.safeParse(jsonData) : null;
      const data = schemaData?.success ? (schemaData.data as z.infer<T>) : jsonData;
      let error: z.ZodError | Error | null = null;

      try {
        if (schema && schemaData?.error) {
          throw schemaData.error;
        }

        if (!_handler) {
          throw new Error('Action POST handler not set! Every action must have a POST handler.');
        }

        return await _handler(c, { data });
      } catch (e) {
        error = e as Error | z.ZodError;
        !IS_PROD && console.error(error);
      }

      if (error && _errorHandler) {
        // @ts-ignore
        return await returnHTMLResponse(c, () => _errorHandler(c, { data, error }), {
          status: 400,
        });
      }

      return await returnHTMLResponse(c, () => api.render({ data, error }), { status: 400 });
    },
  };

  return api;
}

/**
 * Form route handler helper
 */
export type THSHandlerResponse = (context: Context) => THSResponseTypes | Promise<THSResponseTypes>;

/**
 * Return JSON data structure for a given FormData object
 * Accounts for array fields (e.g. name="options[]" or <select multiple>)
 *
 * @link https://stackoverflow.com/a/75406413
 */
export function unstable__formDataToJSON(formData: FormData): Record<string, string | string[]> {
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
