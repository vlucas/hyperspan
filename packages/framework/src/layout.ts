import { html } from '@hyperspan/html';
import { JS_IMPORT_MAP, buildClientJS } from './client/js';
import { CSS_PUBLIC_PATH, CSS_ROUTE_MAP } from './client/css';
import type { Hyperspan as HS } from './types';

const clientStreamingJS = await buildClientJS(import.meta.resolve('./client/_hs/hyperspan-streaming.client'));

/**
 * Output the importmap for the client so we can use ESModules on the client to load JS files on demand
 */
export function hyperspanScriptTags() {
  return html`
    <script type="importmap">
      {"imports": ${Object.fromEntries(JS_IMPORT_MAP)}}
    </script>
    <script id="hyperspan-streaming-script">
      // [Hyperspan] Streaming - Load the client streaming JS module only when the first chunk is loaded
      window._hsc = window._hsc || [];
      var hscc = function(e) {
        if (window._hscc !== undefined) {
          window._hscc(e);
        }
      };
      window._hsc.push = function(e) {
        Array.prototype.push.call(window._hsc, e);
        if (window._hsc.length === 1) {
          const script = document.createElement('script');
          script.src = "${clientStreamingJS.publicPath}";
          document.body.appendChild(script);
          script.onload = function() {
            hscc(e);
          };
        }
        hscc(e);
      };
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