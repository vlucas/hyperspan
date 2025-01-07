import { HSTemplate, html } from '../html';
import { z } from 'zod';
import { HSRequestContext } from '../app';
import type { ZodSchema } from 'zod';

/**
 * ===========================================================================
 */

/**
 * Route
 * Define a route with an optional loading placeholder
 */
export function createRoute(handler: THSRouteHandler): HSRoute {
  return new HSRoute(handler);
}

/**
 * Form + route handler
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
export function createForm(
  renderForm: (data?: any) => THSResponseTypes,
  schema?: ZodSchema | null
): HSFormRoute {
  return new HSFormRoute(renderForm, schema);
}

/**
 * Types
 */
export type THSComponentReturn = HSTemplate | string | number | null;
export type THSResponseTypes = HSTemplate | Response | string | null;
export type THSRouteHandler = (
  context: HSRequestContext,
  middlewareResult?: Record<string, any> // @TODO: Move this to context...
) => THSResponseTypes | Promise<THSResponseTypes>;
export type THSFormRouteHandler = (
  context: HSRequestContext,
  formData?: Record<string, any> // Parsed data from 'formData' object or query string w/input validation
) => THSResponseTypes | Promise<THSResponseTypes>;
export type THSRouteHandlerNonAsync = (context: HSRequestContext) => THSResponseTypes;
export const HS_DEFAULT_LOADING = () => html`<div>Loading...</div>`;

/**
 * Route handler helper
 */
export class HSRoute {
  _kind = 'hsRoute';
  _handlers: Record<string, THSRouteHandler> = {};
  _methods: null | string[] = null;
  constructor(handler: THSRouteHandler) {
    this._handlers.GET = handler;
  }
}

/**
 * Form route handler helper
 */
export type THSFormRenderer = (data?: any) => THSResponseTypes;
export class HSFormRoute {
  _kind = 'hsFormRoute';
  _handlers: Record<string, THSRouteHandler> = {};
  _form: THSFormRenderer;
  _methods: null | string[] = null;
  _schema: null | ZodSchema = null;

  constructor(renderForm: THSFormRenderer, schema: ZodSchema | null = null) {
    // Haz schema?
    if (schema) {
      type TSchema = z.infer<typeof schema>;
      this._form = renderForm as (data: TSchema) => THSResponseTypes;
      this._schema = schema;
    } else {
      this._form = renderForm;
    }

    // GET request is render form by default
    this._handlers.GET = (ctx: HSRequestContext) => renderForm(this.getDefaultData());
  }

  // Form data
  getDefaultData() {
    if (!this._schema) {
      return {};
    }

    type TSchema = z.infer<typeof this._schema>;
    const data = this._schema.optional().parse({});
    return data as TSchema;
  }

  /**
   * Get form renderer method
   */
  renderForm(data?: any) {
    return this._form(data || this.getDefaultData());
  }

  // HTTP handlers
  get(handler: THSRouteHandler) {
    this._handlers.GET = handler;
    return this;
  }

  patch(handler: THSRouteHandler) {
    this._handlers.PATCH = handler;
    return this;
  }

  post(handler: THSRouteHandler) {
    this._handlers.POST = handler;
    return this;
  }

  put(handler: THSRouteHandler) {
    this._handlers.PUT = handler;
    return this;
  }

  delete(handler: THSRouteHandler) {
    this._handlers.DELETE = handler;
    return this;
  }
}
