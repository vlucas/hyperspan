import { html, HSHtml } from '@hyperspan/html';
import * as z from 'zod/v4';
import { HTTPException } from 'hono/http-exception';

import type { THSResponseTypes } from './server';
import type { Context } from 'hono';

/**
 * Actions = Form + route handler
 * Automatically handles and parses form data
 *
 * INITIAL IDEA OF HOW THIS WILL WORK:
 * ---
 * 1. Renders component as initial form markup for GET request
 * 2. Bind form onSubmit function to custom client JS handling
 * 3. Submits form with JavaScript fetch()
 * 4. Replaces form content with content from server
 * 5. All validation and save logic is on the server
 * 6. Handles any Exception thrown on server as error displayed in client
 */
export interface HSAction<T extends z.ZodTypeAny> {
  _kind: string;
  form(renderForm: ({ data }: { data?: z.infer<T> }) => HSHtml): HSAction<T>;
  post(handler: (c: Context, { data }: { data?: z.infer<T> }) => THSResponseTypes): HSAction<T>;
  error(
    handler: (
      c: Context,
      { data, error }: { data?: z.infer<T>; error?: z.ZodError | Error }
    ) => THSResponseTypes
  ): HSAction<T>;
  render(props?: { data?: z.infer<T>; error?: z.ZodError | Error }): THSResponseTypes;
  run(method: 'GET' | 'POST', c: Context): Promise<THSResponseTypes>;
}

export function createAction<T extends z.ZodTypeAny>(
  schema: T | null = null,
  form: Parameters<HSAction<T>['form']>[0] | null = null
) {
  let _handler: Parameters<HSAction<T>['post']>[0] | null = null,
    _form: Parameters<HSAction<T>['form']>[0] | null = form,
    _errorHandler: Parameters<HSAction<T>['error']>[0] | null = null;

  const api: HSAction<T> = {
    _kind: 'hsAction',
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

    error(handler) {
      _errorHandler = handler;
      return api;
    },

    /**
     * Get form renderer method
     */
    render(formState?: { data?: z.infer<T>; error?: z.ZodError | Error }) {
      const form = _form ? _form(formState || {}) : null;
      return form ? html`<hs-action>${form}</hs-action>` : null;
    },

    /**
     * Run action
     *
     * Returns result from form processing if successful
     * Re-renders form with data and error information otherwise
     */
    async run(method: 'GET' | 'POST', c: Context) {
      if (method === 'GET') {
        return api.render();
      }

      if (method !== 'POST') {
        throw new HTTPException(405, { message: 'Actions only support GET and POST requests' });
      }

      const formData = await c.req.formData();
      const jsonData = formDataToJSON(formData);
      const schemaData = schema ? schema.safeParse(jsonData) : null;
      const data = schemaData?.success ? (schemaData.data as z.infer<T>) : undefined;
      let error: z.ZodError | Error | null = null;

      try {
        if (schema && schemaData?.error) {
          throw schemaData.error;
        }

        if (!_handler) {
          throw new Error('Action POST handler not set! Every action must have a POST handler.');
        }

        return _handler(c, { data });
      } catch (e) {
        error = e as Error | z.ZodError;
      }

      if (error && _errorHandler) {
        return _errorHandler(c, { data, error });
      }

      return api.render({ data, error });
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
