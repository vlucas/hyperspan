import type { Plugin } from 'vite';
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetHash } from '@hyperspan/framework/utils';
import { registerImport, JS_ISLAND_PUBLIC_PATH } from '@hyperspan/framework/client/js';
import type { Hyperspan as HS } from '@hyperspan/framework';
import { html } from '@hyperspan/html';
import { h } from 'preact';
import { render as preactRenderToString } from 'preact-render-to-string';
import debug from 'debug';

const log = debug('hyperspan:plugin-preact');

export function buildIslandHtml(
  jsId: string,
  componentName: string,
  esmName: string,
  jsContent: string,
  ssrContent: string,
  options: { loading?: string } = {}
): string {
  const scriptTag = `<script type="module" id="${jsId}_script" data-source-id="${jsId}">import ${componentName} from "${esmName}";${jsContent}</script>`;
  if (options.loading === 'lazy') {
    return `<div id="${jsId}">${ssrContent}</div><div data-loading="lazy" style="height:1px;width:1px;overflow:hidden;"><template>\n${scriptTag}</template></div>`;
  }
  return `<div id="${jsId}">${ssrContent}</div>\n${scriptTag}`;
}

export function renderPreactSSR(Component: unknown, props: Record<string, unknown> = {}): string {
  return preactRenderToString(h(Component as Parameters<typeof h>[0], props));
}

function extractDefaultExportName(code: string): string | null {
  const patterns = [
    /export\{([^\s]+) as default\}/,
    /export default function\s+([^\s(]+)/,
    /export default function\s*\(/,
    /export default const\s+([^\s=]+)/,
    /export default class\s+([^\s{]+)/,
  ];
  for (const re of patterns) {
    const m = code.match(re);
    if (m?.[1]) return m[1];
  }
  if (/export default function/.test(code)) return 'DefaultComponent';
  const anyMatch = code.match(/export default\s+([A-Za-z_$][\w$]*)/);
  return anyMatch?.[1] ?? null;
}

function isIslandComponent(id: string): boolean {
  return (
    (id.includes('/app/components/') || id.includes('\\app\\components\\')) &&
    id.endsWith('.tsx') &&
    !id.includes('node_modules')
  );
}

/**
 * Vite plugin for Preact islands.
 */
export function preactVitePlugin(): Plugin {
  const preactClientPath = resolve(dirname(fileURLToPath(import.meta.url)), './preact-client.ts');

  return {
    name: 'hyperspan-preact',
    enforce: 'pre',

    config() {
      return {
        optimizeDeps: {
          include: ['preact', 'preact/hooks', 'preact/jsx-runtime'],
        },
      };
    },

    configureServer() {
      // In Vite serve, Preact is resolved from node_modules / optimizeDeps.
      // Import-map aliases for the browser bundle are set during production build.
      const clientUrl = '/islands/preact-client.js';
      registerImport('preact', clientUrl);
      registerImport('preact/hooks', clientUrl);
      registerImport('preact/jsx-runtime', clientUrl);
      registerImport('preact/jsx-dev-runtime', clientUrl);
      registerImport('preact/compat', clientUrl);
      registerImport('react', clientUrl);
      registerImport('react-dom', clientUrl);
    },

    async transform(code, id) {
      if (!isIslandComponent(id)) return;

      log('transform island', id);
      const jsId = assetHash(id);
      const esmName = basename(id, '.tsx');
      const componentName = extractDefaultExportName(code);

      if (!componentName) {
        throw new Error(
          `No default export found in ${id}. Did you forget to export a Preact component?`
        );
      }

      const publicPath = `${JS_ISLAND_PUBLIC_PATH}/${esmName}.js`;
      registerImport(esmName, publicPath);

      const moduleCode = `// hyperspan:processed
import { h as __hs_h, render as __hs_render, hydrate as __hs_hydrate } from 'preact';
import { render as __hs_renderToString } from 'preact-render-to-string';
import { buildIslandHtml as __hs_buildIslandHtml } from '@hyperspan/plugin-preact';

${code}

function __hs_renderIsland(jsContent = '', ssrContent = '', options = {}) {
  return __hs_buildIslandHtml("${jsId}", "${componentName}", "${esmName}", jsContent, ssrContent, options);
}

${componentName}.__HS_ISLAND = {
  id: "${jsId}",
  render: (props, options = {}) => {
    if (options.ssr === false) {
      const jsContent = \`import { h as __hs_h, render as __hs_render } from 'preact';__hs_render(__hs_h(${componentName}, \${JSON.stringify(props)}), document.getElementById("${jsId}"));\`;
      return __hs_renderIsland(jsContent, '', options);
    }
    const ssrContent = __hs_renderToString(__hs_h(${componentName}, props));
    const jsContent = \`import { h as __hs_h, hydrate as __hs_hydrate } from 'preact';__hs_hydrate(__hs_h(${componentName}, \${JSON.stringify(props)}), document.getElementById("${jsId}"));\`;
    return __hs_renderIsland(jsContent, ssrContent, options);
  }
};
`;

      return { code: moduleCode, map: null };
    },

    buildStart() {
      // emitFile is only available during production builds, not vite serve.
      if (this.meta.watchMode) return;
      try {
        this.emitFile({
          type: 'chunk',
          id: preactClientPath,
          fileName: 'islands/preact-client.js',
        });
      } catch {
        // Serve mode — client is resolved via import map / Vite deps instead.
      }
    },
  };
}

/**
 * Hyperspan config plugin (no-op in v2 — use preactVitePlugin in vite.config.ts).
 */
export function preactPlugin(): HS.Plugin {
  return () => {
    log('preactPlugin loaded (Vite handles bundling in v2)');
  };
}

export function renderPreactIsland(
  Component: {
    __HS_ISLAND?: { render: (props: unknown, options: unknown) => string };
    name?: string;
  },
  props: Record<string, unknown> = {},
  options: { ssr?: boolean; loading?: string } = { ssr: true }
) {
  if (Component.__HS_ISLAND?.render) {
    return html.raw(Component.__HS_ISLAND.render(props, options));
  }
  throw new Error(
    `Module ${Component.name} was not loaded with an island plugin! Add preactVitePlugin() to vite.config.ts.`
  );
}
