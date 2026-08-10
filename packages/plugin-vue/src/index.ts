import './types.d';
import type { Plugin } from 'vite';
import { basename } from 'node:path';
import { registerImport, JS_ISLAND_PUBLIC_PATH } from '@hyperspan/framework/client/js';
import { assetHash } from '@hyperspan/framework/utils';
import type { Hyperspan as HS } from '@hyperspan/framework';
import { html } from '@hyperspan/html';
import debug from 'debug';
import {
  parse,
  compileScript,
  compileTemplate,
  rewriteDefault,
} from '@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js';

const log = debug('hyperspan:plugin-vue');

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

export async function renderVueSSR(
  Component: unknown,
  props: Record<string, unknown> = {}
): Promise<string> {
  const { createSSRApp } = await import('vue');
  const { renderToString } = await import('@vue/server-renderer');
  const app = createSSRApp(Component as Parameters<typeof createSSRApp>[0], props);
  return renderToString(app);
}

async function compileVueSFC(
  source: string,
  filepath: string,
  id: string,
  ssr: boolean
): Promise<string> {
  const { descriptor, errors } = parse(source, { filename: filepath });

  if (errors.length) {
    throw new Error(
      `Vue SFC parse errors in ${filepath}:\n${errors.map((e) => e.message).join('\n')}`
    );
  }

  let scriptCode = 'const __sfc__ = {};';
  let bindingMetadata: Record<string, unknown> | undefined;
  if (descriptor.script || descriptor.scriptSetup) {
    const scriptResult = compileScript(descriptor, { id });
    bindingMetadata = scriptResult.bindings;
    scriptCode = rewriteDefault(scriptResult.content, '__sfc__');
  }

  let templateCode = '';
  if (descriptor.template) {
    const templateResult = compileTemplate({
      source: descriptor.template.content,
      filename: filepath,
      id,
      ssr,
      scoped: descriptor.styles.some((s) => s.scoped),
      ssrCssVars: [],
      compilerOptions: bindingMetadata ? { bindingMetadata } : undefined,
    });

    if (templateResult.errors.length) {
      throw new Error(
        `Vue SFC template errors in ${filepath}:\n${templateResult.errors.map((e) => (typeof e === 'string' ? e : e.message)).join('\n')}`
      );
    }

    templateCode = templateResult.code;
  }

  const renderKey = ssr ? 'ssrRender' : 'render';
  return `${scriptCode}\n${templateCode}\n__sfc__.${renderKey} = ${renderKey};\nexport default __sfc__;\n`;
}

function isIslandComponent(id: string): boolean {
  return (
    (id.includes('/app/components/') || id.includes('\\app\\components\\')) &&
    id.endsWith('.vue') &&
    !id.includes('node_modules')
  );
}

export function vueVitePlugin(): Plugin {
  return {
    name: 'hyperspan-vue',
    enforce: 'pre',

    configureServer() {
      const clientUrl = `${JS_ISLAND_PUBLIC_PATH}/vue-client.js`;
      registerImport('vue', clientUrl);
      registerImport('vue/dist/vue.esm-bundler.js', clientUrl);
    },

    async transform(code, id) {
      if (!isIslandComponent(id)) return;

      log('transform vue island', id);
      const jsId = assetHash(id);
      const esmName = basename(id, '.vue');
      const componentName = '__hs_vue_component';

      const ssrCode = await compileVueSFC(code, id, jsId, true);
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
const ${componentName} = __sfc__;

function __hs_renderIsland(jsContent = '', ssrContent = '', options = {}) {
  return __hs_buildIslandHtml("${jsId}", "__hs_vue_component", "${esmName}", jsContent, ssrContent, options);
}

${componentName}.__HS_ISLAND = {
  id: "${jsId}",
  render: async (props, options = {}) => {
    const { createSSRApp: __hs_createSSRApp } = await import('vue');
    const { renderToString: __hs_renderToString } = await import('@vue/server-renderer');

    if (options.ssr === false) {
      const jsContent = \`import { createApp as __hs_createApp } from 'vue';__hs_createApp(__hs_vue_component, \${JSON.stringify(props)}).mount(document.getElementById("${jsId}"));\`;
      return __hs_renderIsland(jsContent, '', options);
    }

    const app = __hs_createSSRApp(${componentName}, props);
    const ssrContent = await __hs_renderToString(app);
    const jsContent = \`import { createSSRApp as __hs_createSSRApp } from 'vue';__hs_createSSRApp(__hs_vue_component, \${JSON.stringify(props)}).mount(document.getElementById("${jsId}"));\`;
    return __hs_renderIsland(jsContent, ssrContent, options);
  }
};
`;

      return { code: moduleCode, map: null };
    },
  };
}

export function vuePlugin(): HS.Plugin {
  return () => {
    log('vuePlugin loaded (Vite handles bundling in v2)');
  };
}

export async function renderVueIsland(
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
    `Module ${Component.name} was not loaded with an island plugin! Add vueVitePlugin() to vite.config.ts.`
  );
}
