import { html } from '@hyperspan/html';
import { JS_IMPORT_MAP } from './client/js';
import { CSS_PUBLIC_PATH, CSS_ROUTE_MAP } from './client/css';
import type { Hyperspan as HS } from './types';

/**
 * Output the importmap for the client so we can use ESModules on the client to load JS files on demand
 */
export function hyperspanScriptTags() {
  return html`
    <script type="importmap">
      {"imports": ${Object.fromEntries(JS_IMPORT_MAP)}}
    </script>
  `;
}

/**
 * Output style tags for the current route's CSS imports
 */
export function hyperspanStyleTags(context: HS.Context) {
  const styleTags = [];
  const cssImports = context.route.cssImports ?? CSS_ROUTE_MAP.get(context.route.path) ?? [];

  for (const cssFile of cssImports) {
    styleTags.push(html`
      <link rel="stylesheet" href="${CSS_PUBLIC_PATH}/${cssFile}" />
    `);
  }

  return styleTags;
}