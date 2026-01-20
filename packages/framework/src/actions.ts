import { html } from '@hyperspan/html';
import { createRoute, HTTPResponseException, returnHTMLResponse } from './server';
import * as z from 'zod/v4';
import type { Hyperspan as HS } from './types';
import { assetHash, formDataToJSON } from './utils';
import { buildClientJS } from './client/js';
import { validateBody, ZodValidationError } from './middleware';
import { debug } from 'debug';

const log = debug('hyperspan:actions');
const actionsClientJS = await buildClientJS(import.meta.resolve('./client/_hs/hyperspan-actions.client'));

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
export function createAction<T extends z.ZodObject<any, any>>(params: { name: string; schema?: T }): HS.Action<T> {
  const { name, schema } = params;
  const path = `/__actions/${assetHash(name)}`;

  let _handler: Parameters<HS.Action<T>['post']>[0] | null = null;
  let _errorHandler: Parameters<HS.Action<T>['errorHandler']>[0] | null = null;

  const route = createRoute({ path, name })
    .get((c: HS.Context) => api.render(c))
    .post(async (c: HS.Context) => {
      if (!_handler) {
        throw new Error('Action POST handler not set! Every action must have a POST handler.');
      }

      const data = c.vars.body as z.infer<T> || formDataToJSON(await c.req.formData()) || {};
      log('POST handler', { data });
      const response = await _handler(c, { data });
      log('POST handler response', { response });

      if (response instanceof Response) {
        // Replace redirects with special header because fetch() automatically follows redirects
        // and we want to redirect the user to the actual full page instead
        if ([301, 302, 307, 308].includes(response.status)) {
          response.headers.set('X-Redirect-Location', response.headers.get('Location') || '/');
          response.headers.delete('Location');
        }
      }

      return response;
    }, { middleware: schema ? [validateBody(schema)] : [] })
    /**
     * Custom error handler for the action since validateBody() throws a HTTPResponseException
     */
    .errorHandler(async (c: HS.Context, err: HTTPResponseException) => {
      const data = c.vars.body as z.infer<T> || formDataToJSON(await c.req.formData()) || {};
      const error = err._error as ZodValidationError || err;

      // Set the status to 400 if it's a ZodValidationError, otherwise 500 (Error thrown by user POST handler)
      c.res.status = err._error ? 400 : 500;

      log('errorHandler', { data, error });

      return await returnHTMLResponse(c, () => {
        return _errorHandler ? _errorHandler(c, { data, error }) : api.render(c, { data, error });
      }, { status: 400 });
    });

  // Set the name of the action for the route
  route._config.name = name;

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
      return formContent ? html`<hs-action url="${this._path()}">${formContent}</hs-action>${actionsClientJS.renderScriptTag()}` : null;
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