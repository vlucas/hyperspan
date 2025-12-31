import { html, HSHtml } from '@hyperspan/html';
import { createRoute, returnHTMLResponse } from './server';
import * as z from 'zod/v4';
import type { Hyperspan as HS } from './types';
import { assetHash } from './utils';
import * as actionsClient from './client/_hs/hyperspan-actions.client';
import { renderClientJS } from './client/js';

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
export function createAction<T extends z.ZodTypeAny>(params: { name: string; schema?: T }): HS.Action<T> {
  const { name, schema } = params;
  const path = `/__actions/${assetHash(name)}`;

  let _handler: Parameters<HS.Action<T>['post']>[0] | null = null;
  let _errorHandler: Parameters<HS.Action<T>['errorHandler']>[0] | null = null;

  const route = createRoute({ path, name })
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

  const api: HS.Action<T> = {
    _kind: 'hsAction',
    _config: route._config,
    _path() {
      return path;
    },
    _form: null,
    /**
     * Form to render
     * This will be wrapped in a <hs-action> web component and submitted via fetch()
     */
    form(form: HS.ActionFormHandler<T>) {
      api._form = form;
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
     * Get form renderer method
     */
    render(c: HS.Context, props?: HS.ActionProps<T>) {
      const formContent = api._form ? api._form(c, props || {}) : null;
      return formContent ? html`<hs-action url="${this._path()}">${formContent}</hs-action>${renderClientJS(actionsClient)}` : null;
    },
    errorHandler(handler) {
      _errorHandler = handler;
      return api;
    },
    middleware(middleware: Array<HS.MiddlewareFunction>) {
      route.middleware(middleware);
      return api;
    },
    fetch: route.fetch,
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