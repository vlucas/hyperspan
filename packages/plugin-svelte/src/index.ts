import type { Plugin } from 'vite';
import { assetHash } from '@hyperspan/framework/utils';
import { registerImport, JS_ISLAND_PUBLIC_PATH } from '@hyperspan/framework/client/js';
import { renderIsland } from '@hyperspan/framework';
import type { Hyperspan as HS } from '@hyperspan/framework';
import { compile } from 'svelte/compiler';
import {
  registerIslandPlugin,
  isIslandModule,
  islandPluginResolveId,
  splitIslandId,
  registerClientChunkAliases,
} from '@hyperspan/vite-plugin/islands';
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
  options: { loading?: string; exportKind?: 'default' | 'named' } = {}
): string {
  const importStmt =
    options.exportKind === 'named'
      ? `import { ${componentName} } from "${esmName}";`
      : `import ${componentName} from "${esmName}";`;
  const scriptTag = `<script type="module" id="${jsId}_script" data-source-id="${jsId}">${importStmt}${jsContent}</script>`;
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

export function svelteIslandPlugin(): Plugin {
  return {
    name: 'hyperspan-svelte',
    enforce: 'pre',

    resolveId: islandPluginResolveId('svelte', '.svelte'),

    configureServer() {
      const clientUrl = `${JS_ISLAND_PUBLIC_PATH}/svelte-client.js`;
      for (const spec of SVELTE_SPECIFIERS) {
        registerImport(spec, clientUrl);
      }
    },

    generateBundle(_options, bundle) {
      registerClientChunkAliases(
        bundle,
        (fileName) => fileName.includes('svelte-client'),
        SVELTE_SPECIFIERS
      );
    },

    async transform(code, id) {
      if (!isIslandModule(id, 'svelte', '.svelte')) return;

      log('transform svelte island', id);
      const cleanId = splitIslandId(id).path;
      const jsId = assetHash(cleanId);
      const esmName = `island-${assetHash(cleanId)}`;

      const ssrResult = compile(code, { filename: cleanId, generate: 'server' });
      const ssrCode = ssrResult.js.code;
      const componentName = extractComponentName(ssrCode);

      if (!componentName) {
        throw new Error(
          `No default export found in ${cleanId}. Export a default Svelte component and import with \`with { island: 'svelte' }\`.`
        );
      }

      registerImport(esmName, `${JS_ISLAND_PUBLIC_PATH}/${esmName}.js`);

      const moduleCode = `// hyperspan:processed
function __hs_buildIslandHtml(jsId, componentName, esmName, jsContent, ssrContent, options) {
  options = options || {};
  const importStmt = 'import ' + componentName + ' from "' + esmName + '";';
  const scriptTag = \`<script type="module" id="\${jsId}_script" data-source-id="\${jsId}">\${importStmt}\${jsContent}</script>\`;
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
  registerIslandPlugin('svelte', { vitePlugin: svelteIslandPlugin });
  return () => {
    log('sveltePlugin loaded');
  };
}

export async function renderSvelteIsland(
  Component: Parameters<typeof renderIsland>[0],
  props: Record<string, unknown> = {},
  options: Parameters<typeof renderIsland>[2] = { ssr: true }
) {
  const result = renderIsland(Component, props, options);
  if (result != null && typeof (result as Promise<unknown>).then === 'function') {
    return await result;
  }
  return result;
}
