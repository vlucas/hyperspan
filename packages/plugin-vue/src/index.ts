import './types.d';
import type { Plugin } from 'vite';
import { registerImport, JS_ISLAND_PUBLIC_PATH } from '@hyperspan/framework/client/js';
import { assetHash } from '@hyperspan/framework/utils';
import { renderIsland } from '@hyperspan/framework';
import type { Hyperspan as HS } from '@hyperspan/framework';
import {
  registerIslandPlugin,
  isIslandModule,
  islandPluginResolveId,
  splitIslandId,
} from '@hyperspan/vite-plugin/islands';
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

export function vueIslandPlugin(): Plugin {
  return {
    name: 'hyperspan-vue',
    enforce: 'pre',

    resolveId: islandPluginResolveId('vue', '.vue'),

    configureServer() {
      const clientUrl = `${JS_ISLAND_PUBLIC_PATH}/vue-client.js`;
      registerImport('vue', clientUrl);
      registerImport('vue/dist/vue.esm-bundler.js', clientUrl);
    },

    async transform(code, id) {
      if (!isIslandModule(id, 'vue', '.vue')) return;

      log('transform vue island', id);
      const cleanId = splitIslandId(id).path;
      const jsId = assetHash(cleanId);
      const esmName = `island-${assetHash(cleanId)}`;
      const componentName = '__hs_vue_component';

      const ssrCode = await compileVueSFC(code, cleanId, jsId, true);
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
    const jsContent = \`import { createApp as __hs_createApp } from 'vue';__hs_createApp(__hs_vue_component, \${JSON.stringify(props)}).mount(document.getElementById("${jsId}"));\`;
    return __hs_renderIsland(jsContent, ssrContent, options);
  }
};
`;

      return { code: moduleCode, map: null };
    },
  };
}

export function vuePlugin(): HS.Plugin {
  registerIslandPlugin('vue', { vitePlugin: vueIslandPlugin });
  return () => {
    log('vuePlugin loaded');
  };
}

export async function renderVueIsland(
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
