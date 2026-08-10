import type { Plugin } from 'vite';
import { basename } from 'node:path';
import { assetHash } from '@hyperspan/framework/utils';
import { registerImport, JS_ISLAND_PUBLIC_PATH } from '@hyperspan/framework/client/js';
import type { Hyperspan as HS } from '@hyperspan/framework';
import { html } from '@hyperspan/html';
import { compile } from 'svelte/compiler';
import debug from 'debug';
import './types.d';

const log = debug('hyperspan:plugin-svelte');

const SVELTE_SPECIFIERS = [
  'svelte',
  'svelte/store',
  'svelte/motion',
  'svelte/transition',
  'svelte/animate',
  'svelte/easing',
  'svelte/internal',
  'svelte/internal/disclose-version',
  'svelte/internal/client',
] as const;

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

export async function renderSvelteSSR(
  Component: unknown,
  props: Record<string, unknown> = {}
): Promise<string> {
  const { render } = await import('svelte/server');
  return render(Component as ConstructorParameters<typeof render>[0], { props }).html;
}

function isIslandComponent(id: string): boolean {
  return (
    (id.includes('/app/components/') || id.includes('\\app\\components\\')) &&
    id.endsWith('.svelte') &&
    !id.includes('node_modules')
  );
}

function extractComponentName(ssrCode: string): string | null {
  const patterns = [
    /export\{([^\s]+) as default\}/,
    /export default function\s+([^\s(]+)/,
    /export default\s+([^\s;{]+)/,
  ];
  for (const re of patterns) {
    const m = ssrCode.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function svelteVitePlugin(): Plugin {
  return {
    name: 'hyperspan-svelte',
    enforce: 'pre',

    configureServer() {
      const clientUrl = `${JS_ISLAND_PUBLIC_PATH}/svelte-client.js`;
      for (const spec of SVELTE_SPECIFIERS) {
        registerImport(spec, clientUrl);
      }
    },

    async transform(code, id) {
      if (!isIslandComponent(id)) return;

      log('transform svelte island', id);
      const jsId = assetHash(id);
      const esmName = basename(id, '.svelte');

      const ssrResult = compile(code, { filename: id, generate: 'server' });
      const ssrCode = ssrResult.js.code;
      const componentName = extractComponentName(ssrCode);

      if (!componentName) {
        throw new Error(`No default export found in ${id}. Export a default Svelte component.`);
      }

      registerImport(esmName, `${JS_ISLAND_PUBLIC_PATH}/${esmName}.js`);

      const moduleCode = `// hyperspan:processed
function __hs_buildIslandHtml(jsId, componentName, esmName, jsContent, ssrContent, options) {
  options = options || {};
  const scriptTag = \`<script type="module" id="\${jsId}_script" data-source-id="\${jsId}">import \${componentName} from "\${esmName}";\${jsContent}</script>\`;
  if (options.loading === 'lazy') {
    return \`<div id="\${jsId}">\${ssrContent}</div><div data-loading="lazy" style="height:1px;width:1px;overflow:hidden;"><template>\\n\${scriptTag}</template></div>\`;
  }
  return \`<div id="\${jsId}">\${ssrContent}</div>\\n\${scriptTag}\`;
}

${ssrCode}

function __hs_renderIsland(jsContent = '', ssrContent = '', options = {}) {
  return __hs_buildIslandHtml("${jsId}", "${componentName}", "${esmName}", jsContent, ssrContent, options);
}

${componentName}.__HS_ISLAND = {
  id: "${jsId}",
  render: async (props, options = {}) => {
    const { render: __hs_svelte_render } = await import('svelte/server');
    if (options.ssr === false) {
      const jsContent = \`import { mount as __hs_mount } from 'svelte';__hs_mount(${componentName}, { target: document.getElementById("${jsId}"), props: \${JSON.stringify(props)} });\`;
      return __hs_renderIsland(jsContent, '', options);
    }
    const { html: ssrContent } = __hs_svelte_render(${componentName}, { props });
    const jsContent = \`import { hydrate as __hs_hydrate } from 'svelte';__hs_hydrate(${componentName}, { target: document.getElementById("${jsId}"), props: \${JSON.stringify(props)} });\`;
    return __hs_renderIsland(jsContent, ssrContent, options);
  }
};
`;

      return { code: moduleCode, map: null };
    },
  };
}

export function sveltePlugin(): HS.Plugin {
  return () => {
    log('sveltePlugin loaded (Vite handles bundling in v2)');
  };
}

export async function renderSvelteIsland(
  Component: {
    __HS_ISLAND?: { render: (props: unknown, options: unknown) => Promise<string> };
    name?: string;
  },
  props: Record<string, unknown> = {},
  options: { ssr?: boolean; loading?: string } = { ssr: true }
) {
  if (Component.__HS_ISLAND?.render) {
    return html.raw(await Component.__HS_ISLAND.render(props, options));
  }
  throw new Error(
    `Module ${Component.name} was not loaded with an island plugin! Add svelteVitePlugin() to vite.config.ts.`
  );
}
