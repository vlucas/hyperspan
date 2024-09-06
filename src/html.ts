import escapeHTML from 'escape-html';
import { md5 } from './clientjs/md5';

const IS_CLIENT = typeof window !== 'undefined';

/**
 * Template object - used so it will be possible to (eventually) pass down context
 */
export class HSTemplate {
  __hsTemplate = true;
  content: any[];
  constructor(content: any[]) {
    this.content = content;
  }
}

/**
 * HTML template
 */
export function html(strings: TemplateStringsArray, ...values: any[]): HSTemplate {
  const content: any[] = [];

  // String templates only?
  if (values.length === 0) {
    content.push({ kind: 'string_safe', value: strings.join('\n') });
    return new HSTemplate(content);
  }

  let i = 0;
  for (i = 0; i < values.length; i++) {
    content.push({ kind: 'string_safe', value: strings[i] });

    let tValue = values[i] === undefined || values[i] === null || values[i] === '' ? '' : values[i];

    if (!Array.isArray(tValue)) {
      tValue = [tValue];
    }

    for (let j = 0; j < tValue.length; j++) {
      content.push({ kind: _typeOf(tValue[j]), value: tValue[j] });
    }
  }
  content.push({ kind: 'string_safe', value: strings[i] });

  return new HSTemplate(content);
}
// Allow raw/unescaped HTML
html.raw = (value: string) => {
  return new HSTemplate([{ kind: 'string_safe', value }]);
};

type TRenderPromise = {
  id: string;
  pending: boolean;
  value?: any;
  promise: Promise<any>;
};
async function* _render(
  obj: any,
  promises: Array<TRenderPromise> = [],
  { js }: { js: string[] }
): AsyncGenerator<string> {
  let { kind, value } = obj;
  let id = randomId();

  if (!kind || !value) {
    kind = _typeOf(obj);
    value = obj;
  }

  if (value instanceof HSTemplate) {
    yield* renderToStream(value);
  } else if (typeof value.render !== 'undefined') {
    value.id = id;
    yield await value.render();
  } else if (value === undefined || value === null) {
    yield '';
  } else {
    switch (kind) {
      case 'string':
        yield escapeHTML(value);
        break;
      case 'string_safe':
        yield value;
        break;
      case 'array':
        yield* value;
        break;
      case 'promise':
        const promise = value.then((v: unknown) => {
          return _render(v, promises, { js });
        });
        const pid = 'async_' + id;
        promises.push({ id: pid, pending: true, promise });
        yield* renderToStream(html`<div id="${pid}">Loading...</div>`);
        break;
      case 'function':
        const fns = renderFunctionToString(value);
        const fnId = 'fn_' + md5(fns);

        // @ts-ignore
        if (!IS_CLIENT || !window.hyperspan._fn.has(fnId)) {
          js.push(`hyperspan.fn('${fnId}', ${fns});`);
        }

        yield `"hyperspan:${fnId}"`;
        break;
      case 'json':
        yield ''; //JSON.stringify(value);
        break;
      case 'object':
        if (typeof value.render === 'function') {
          yield value.render();
        } else if (typeof value.toString === 'function') {
          yield value.toString();
        } else {
          yield value;
        }
        break;
      case 'generator':
        yield* value;
        break;
      case 'date':
        yield value.toISOString();
        break;
      default:
        yield String(value);
    }
  }
}

/**
 * Render HSTemplate to async generator that streams output to a string
 */
export async function* renderToStream(template: HSTemplate | string): AsyncGenerator<string> {
  let promises: Array<TRenderPromise> = [];
  let js: string[] = [];

  if (typeof template === 'string') {
    return template;
  }

  for (let i = 0; i < template.content.length; i++) {
    yield* _render(template.content[i], promises, { js });
  }

  while (promises.length > 0) {
    const promisesToRun = promises.map((p) =>
      p.promise.then((v) => {
        return { id: p.id, pending: false, value: v, promise: null };
      })
    );
    const result = await Promise.race(promisesToRun);

    yield* renderToStream(html`<template id="${result.id}_content">${result.value}</template>`);

    promises = promises.filter((p) => {
      return p.id !== result.id;
    });
  }

  if (js.length !== 0) {
    yield '<script>' + js.join('\n') + '</script>';
  }
}

/**
 * Render HSTemplate to string (awaits/buffers entire response)
 */
export async function renderToString(template: HSTemplate | string): Promise<string> {
  let result = '';

  for await (const chunk of renderToStream(template)) {
    result += chunk;
  }

  return result;
}

/**
 * Strip extra spacing between HTML tags (used for tests)
 */
export function compressHTMLString(str: string) {
  return str.replace(/(<(pre|script|style|textarea)[^]+?<\/\2)|(^|>)\s+|\s+(?=<|$)/g, '$1$3');
}

/**
 * Generate random ID (used for promise/async resolver)
 */
function randomId() {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * LOL JavaScript...
 */
export function _typeOf(obj: any): string {
  if (obj instanceof Promise) return 'promise';
  if (obj instanceof Date) return 'date';
  if (obj instanceof String) return 'string';
  if (obj instanceof Number) return 'number';
  if (obj instanceof Boolean) return 'boolean';
  if (obj instanceof Function) return 'function';
  if (Array.isArray(obj)) return 'array';
  if (Number.isNaN(obj)) return 'nan';
  if (obj === undefined) return 'undefined';
  if (obj === null) return 'null';
  if (isGenerator(obj)) return 'generator';
  if (isPlainObject(obj)) return 'json';
  return typeof obj;
}

function isGenerator(obj: any): boolean {
  return obj && 'function' == typeof obj.next && 'function' == typeof obj.throw;
}

function isPlainObject(val: any) {
  return Object == val.constructor;
}

/**
 * Client component
 */
export type THSWCState = Record<string, any>;
export type THSWCSetStateArg = THSWCState | ((state: THSWCState) => THSWCState);
export type THSWC = {
  this: THSWC;
  state: THSWCState | undefined;
  id: string;
  setState: (fn: THSWCSetStateArg) => THSWCState;
  mergeState: (newState: THSWCState) => THSWCState;
  render: () => any;
};
export type THSWCUser = Pick<THSWC, 'render'> & Record<string, any>;
export function clientComponent(id: string, wc: THSWCUser) {
  const comp = {
    ...wc,
    state: wc.state || {},
    id,
    randomId() {
      return Math.random().toString(36).substring(2, 9);
    },
    setState(fn: THSWCSetStateArg): THSWCState {
      try {
        const val = typeof fn === 'function' ? fn(this.state) : fn;
        this.state = val;
        const el = document.getElementById(this.id);
        if (el) {
          el.dataset.state = JSON.stringify(val);
          //this.render();
        }
      } catch (e) {
        console.error(e);
      }
      return this.state;
    },
    mergeState(newState: THSWCState): THSWCState {
      return this.setState(Object.assign(this.state, newState));
    },
  };

  if (typeof window !== 'undefined') {
    // @ts-ignore
    window.hyperspan.wc.set(id, comp);
  }

  return (attrs?: Record<string, string>, state?: Record<string, any>) => {
    const _state = Object.assign({}, comp.state, state || {});
    return html`
      <script>
        ${html.raw(renderObjectToLiteralString(comp))};
      </script>
      <hs-wc id="${attrs?.id || id}" data-state="${JSON.stringify(_state)}"></hs-wc>
    `;
  };
}

export function renderFunctionToString(fn: Function): string {
  let fns = fn.toString();
  const firstLine = fns.split('\n')[0];
  const isFatArrow = firstLine.includes('=>');
  const isAsync = firstLine.includes('async');
  const hasFunctionWord = firstLine.includes('function');

  // Ensure word 'function' is present
  if (isFatArrow) {
    fns = 'function (...args) { return (' + fns + ')(..args); }';
  } else {
    // Class methods can omit the 'function' word without being a fat arrow function
    if (!hasFunctionWord) {
      fns = 'function ' + fns;
    }
  }

  // Ensure 'async' is first word in function declration
  if (isAsync) {
    fns = 'async ' + fns.replace('async ', '');
  }

  return fns;
}

/**
 * Render object out to string literal (one level only)
 */
function renderObjectToLiteralString(obj: Record<string, any>): string {
  const lines: string[][] = [];

  let str = 'hyperspan.wc.set("' + obj.id + '", {\n';

  for (const prop in obj) {
    const kind = _typeOf(obj[prop]);
    let val = obj[prop];

    switch (kind) {
      case 'string':
        lines.push([prop, ': ', '"' + val + '"']);
        break;
      case 'object':
      case 'json':
        lines.push([prop, ': ', "JSON.parse('" + JSON.stringify(val) + "')"]);
        break;
      case 'function':
        const fn = val.toString();
        const isFatArrow = fn.split('\n')[0].includes('=>');

        if (isFatArrow) {
          lines.push([prop, ': ', fn]);
        } else {
          lines.push([fn]);
        }
        break;
      default:
        lines.push([prop, ': ', val]);
    }
  }

  str += lines.map((line) => line.join('') + ',').join('\n');
  str += '\n})';

  return str;
}
