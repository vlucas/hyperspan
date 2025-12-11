import { html } from '@hyperspan/html';
import type { Hyperspan as HS } from '../types';

export const JS_PUBLIC_PATH = '/_hs/js';
export const JS_ISLAND_PUBLIC_PATH = '/_hs/js/islands';
export const JS_IMPORT_MAP = new Map<string, string>();

/**
 * Render a client JS module as a script tag
 */
export function renderClientJS<T>(module: T, loadScript?: ((module: T) => void) | string) {
  // @ts-ignore
  if (!module.__CLIENT_JS) {
    throw new Error(
      `[Hyperspan] Client JS was not loaded by Hyperspan! Ensure the filename ends with .client.ts to use this render method.`
    );
  }

  return html.raw(
    // @ts-ignore
    module.__CLIENT_JS.renderScriptTag({
      loadScript: loadScript
        ? typeof loadScript === 'string'
          ? loadScript
          : functionToString(loadScript)
        : undefined,
    })
  );
}

/**
 * Convert a function to a string (results in loss of context!)
 * Handles named, async, and arrow functions
 */
export function functionToString(fn: any) {
  let str = fn.toString().trim();

  // Ensure consistent output & handle async
  if (!str.includes('function ')) {
    if (str.includes('async ')) {
      str = 'async function ' + str.replace('async ', '');
    } else {
      str = 'function ' + str;
    }
  }

  const lines = str.split('\n');
  const firstLine = lines[0];
  const lastLine = lines[lines.length - 1];

  // Arrow function conversion
  if (!lastLine?.includes('}')) {
    return str.replace('=> ', '{ return ') + '; }';
  }

  // Cleanup arrow function
  if (firstLine.includes('=>')) {
    return str.replace('=> ', '');
  }

  return str;
}

/**
 * Island defaults
 */
export const ISLAND_DEFAULTS: () => HS.ClientIslandOptions = () => ({
  ssr: true,
  loading: undefined,
});

export function renderIsland(Component: any, props: any, options = ISLAND_DEFAULTS()) {
  // Render island with its own logic
  if (Component.__HS_ISLAND?.render) {
    return html.raw(Component.__HS_ISLAND.render(props, options));
  }

  throw new Error(
    `Module ${Component.name} was not loaded with an island plugin! Did you forget to install an island plugin and add it to the 'islandPlugins' option in your hyperspan.config.ts file?`
  );
}