import { html } from './html';
import { CSS_PUBLIC_PATH } from './client/css';
import { getImportMap, getRouteCss } from './client/manifest';
import { actionsClient, streamingClient } from './client/js';
import type { Hyperspan as HS } from './types';

/**
 * Output the importmap for the client so we can use ESModules on the client to load JS files on demand.
 *
 * The streaming client MUST be loaded as a classic <script>, not type=module.
 * Browsers defer all ESM until the document finishes parsing, which would hold
 * every streaming chunk until the whole page is done. A dynamically inserted
 * classic script runs as soon as it downloads.
 */
export function hyperspanScriptTags() {
  const imports = getImportMap();
  const streamingPath = streamingClient.publicPath;

  return html`
    <script type="importmap">
      {"imports": ${imports}}
    </script>
    <script id="hyperspan-streaming-script">
      // [Hyperspan] Streaming - Load the client streaming JS module only when the first chunk is loaded
      window._hsc = window._hsc || [];
      if (!window._hscInit) {
        window._hscInit = true;
        window._hsc.push = function (e) {
          Array.prototype.push.call(window._hsc, e);
          if (!window._hscLoading) {
            window._hscLoading = true;
            const script = document.createElement('script');
            script.src = '${streamingPath}';
            document.body.appendChild(script);
          }
        };
      }
    </script>
  `;
}

/**
 * Output style tags for the current route's CSS imports
 */
export function hyperspanStyleTags(context: HS.Context) {
  const styleTags = [];
  const cssImports = context.route.cssImports?.length
    ? context.route.cssImports
    : getRouteCss(context.route.path);

  for (const cssFile of cssImports) {
    // Absolute Vite/dev URLs (e.g. /app/styles/globals.css) are used as-is;
    // hashed build artifacts are served under /_hs/css/.
    const href = cssFile.startsWith('/') ? cssFile : `${CSS_PUBLIC_PATH}/${cssFile}`;
    styleTags.push(html` <link rel="stylesheet" href="${href}" /> `);
  }

  return styleTags;
}

/**
 * Render the actions client script tag (used by createAction).
 */
export function hyperspanActionsScriptTag() {
  return html`<script type="module" src="${actionsClient.publicPath}"></script>`;
}
