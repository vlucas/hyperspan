import escapeHtml from './escape-html';

export class HSHtml {
  _kind = 'HSHtml';
  content = '';
  asyncContent: Array<{
    id: string;
    promise: Promise<{ id: string; value: unknown }>;
  }>;

  constructor(props: Pick<HSHtml, 'content' | 'asyncContent'>) {
    this.content = props.content;
    this.asyncContent = props.asyncContent;
  }
}

/**
 * Check if the value is a HSHtml object
 */
export function isHSHtml(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    // @ts-ignore
    (value instanceof HSHtml || value.constructor.name === 'HSHtml' || value?._kind === 'HSHtml')
  );
}

let htmlId = 0;
/**
 * Create a new HTML template
 */
export function html(strings: TemplateStringsArray, ...values: any[]): HSHtml {
  const asyncContent: HSHtml['asyncContent'] = [];

  let content = '';
  for (let i = 0; i < strings.length; i++) {
    const value = values[i];
    const kind = _typeOf(value);
    const renderValue = _renderValue(value, { kind, asyncContent }) || '';

    content += strings[i] + (renderValue ? renderValue : '');
  }
  return new HSHtml({ content, asyncContent });
}
// Insert raw HTML as string (do not escape HTML characters)
html.raw = (content: string) => ({ _kind: 'html_safe', content });

/**
 * Provide a custom placeholder for async content.
 * The async content will replace this placeholder when it resolves.
 */
export function placeholder(content: HSHtml, promise: Promise<unknown>) {
  return {
    render() {
      return content;
    },
    async renderAsync() {
      return promise;
    },
  };
}

// Internal method. Render unknown value based on type
// Will always render a string for every value (possibly empty)
// MAY also push new items into 'asyncContent' option to resolve in the future
function _renderValue(
  value: unknown,
  opts: { kind?: string; id?: string; asyncContent: any[] } = {
    asyncContent: [],
  }
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '';
  }
  const kind = opts.kind || _typeOf(value);
  let id = opts.id;

  // THtmlReturn (HTML template)
  if (isHSHtml(value)) {
    // @ts-ignore  value is HSHtml!
    opts.asyncContent.push(...value.asyncContent);
    // @ts-ignore  value is HSHtml!
    return value.content;
  }

  switch (kind) {
    case 'array':
      return (value as any[])
        .map((v) => _renderValue(v, { id, asyncContent: opts.asyncContent }))
        .join('');
    case 'object':
      id = `async_loading_${htmlId++}`;
      // @ts-ignore - this is "raw HTML" object - do not escape
      if (value?._kind === 'html_safe') {
        // @ts-ignore
        return value?.content || '';
      }
      // renderAsync() method
      // @ts-ignore
      if (typeof value.renderAsync === 'function') {
        opts.asyncContent.push({
          id,
          // @ts-ignore
          promise: value.renderAsync().then((result: unknown) => ({
            id,
            value: result,
            asyncContent: opts.asyncContent,
          })),
        });
      }
      // render() method
      // @ts-ignore
      if (typeof value.render === 'function') {
        // @ts-ignore
        return render(_htmlPlaceholder(id, value.render()));
      }
      return JSON.stringify(value);
    case 'promise':
      id = `async_loading_${htmlId++}`;
      opts.asyncContent.push({
        id,
        promise: (value as Promise<any>).then((result: unknown) => ({
          id,
          value: result,
          asyncContent: opts.asyncContent,
        })),
      });
      return render(_htmlPlaceholder(id));
    case 'generator':
      throw new Error('Generators are not supported as a template value at this time. Sorry :(');
  }

  return escapeHtml(String(value));
}

/**
 * Placeholder for async content.
 * This will be replaced with the actual content when the async content is resolved.
 */
function _htmlPlaceholder(id: string | number, content: any = 'Loading...') {
  // prettier-ignore
  return html`<!--hs:loading:${id}--><slot id="${id}">${content}</slot><!--/hs:loading:${id}-->`
}

/**
 * Renders all static markup and non-async content for provided template.
 * This will NOT render any async content. For that, use renderAsync or renderStream.
 */
export function render(tmpl: HSHtml): string {
  return tmpl.content;
}

/**
 * Render HTML and async content as one block and return string output
 * This will wait for ALL async chunks in the template to resolve before rendering.
 * If you want streaming rendering, use 'renderStream' instead.
 */
export async function renderAsync(tmpl: HSHtml): Promise<string> {
  let { content, asyncContent } = tmpl;

  while (asyncContent.length !== 0) {
    // @TODO: Use Promise.allSettled() instead with error handling
    const resolvedHtml = await Promise.all(asyncContent.map((p) => p.promise));
    asyncContent = [];
    resolvedHtml.map((obj) => {
      const r = new RegExp(
        `<\!\-\-hs:loading:${obj.id}\-\->(.*?)<\!\-\-/hs:loading:${obj.id}\-\->`
      );
      const found = content.match(r);

      if (found) {
        content = content.replace(found[0], _renderValue(obj.value, { asyncContent }));
      }
    });
  }

  return content;
}

/**
 * Render HTML as a stream (async generator)
 * Uses Promise.race() to output new resolved chunks of HTML as soon as each promise resolves.
 * Primary render method for streaming HTML from server
 */
export async function* renderStream(tmpl: HSHtml): AsyncGenerator<string> {
  yield render(tmpl);
  let asyncContent = tmpl.asyncContent;

  while (asyncContent.length > 0) {
    // Resolve the next async content as soon as it is ready
    const nextContent = await Promise.race(asyncContent.map((p) => p.promise));

    // Remove current promise from list (resolved now)
    asyncContent = asyncContent.filter((p) => p.id !== nextContent.id);

    const id = nextContent.id;
    const content = _renderValue(nextContent.value, {
      asyncContent,
    });
    const script = html`<template id="${id}_content">${html.raw(content)}<!--end--></template>`;

    yield render(script);
  }
}

/**
 * LOL JavaScript typeof...
 */
export function _typeOf(obj: any): string {
  if (obj instanceof Promise) return 'promise';
  if (obj instanceof Date) return 'date';
  if (obj instanceof String) return 'string';
  if (obj instanceof Number) return 'number';
  if (obj instanceof Boolean) return 'boolean';
  if (obj instanceof Function) return 'function';
  if (Array.isArray(obj)) return 'array';
  if (Number.isNaN(obj)) return 'NaN';
  if (obj === undefined) return 'undefined';
  if (obj === null) return 'null';
  if (isGenerator(obj)) return 'generator';
  return typeof obj;
}

function isGenerator(obj: any): boolean {
  return obj && 'function' == typeof obj.next && 'function' == typeof obj.throw;
}

/**
 * Strip extra spacing between HTML tags (used for caching and tests)
 */
export function compressHTMLString(str: string) {
  return str.replace(/(<(pre|script|style|textarea)[^]+?<\/\2)|(^|>)\s+|\s+(?=<|$)/g, '$1$3');
}
