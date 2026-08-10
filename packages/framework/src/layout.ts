import { html } from '@hyperspan/html';
import { CSS_PUBLIC_PATH } from './client/css';
import { getImportMap, getRouteCss, getClientJSFromManifest } from './client/manifest';
import type { Hyperspan as HS } from './types';

function streamingClientPath(): string {
  return getClientJSFromManifest('streaming').publicPath;
}

/**
 * Output the importmap for the client so we can use ESModules on the client to load JS files on demand
 */
export function hyperspanScriptTags() {
  const imports = getImportMap();
  let streamingPath: string;
  try {
    streamingPath = streamingClientPath();
  } catch {
    streamingPath = '/_hs/js/hyperspan-streaming.client.js';
  }

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
  try {
    const actions = getClientJSFromManifest('actions');
    return html`<script type="module" src="${actions.publicPath}"></script>`;
  } catch {
    return html`<script type="module" src="/_hs/js/hyperspan-actions.client.js"></script>`;
  }
}
