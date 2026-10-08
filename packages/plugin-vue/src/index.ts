/// <reference path="./types.d.ts" />
import type { Plugin } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JS_ISLAND_PUBLIC_PATH } from '@hyperspan/framework/client/js';
import { assetHash } from '@hyperspan/framework/utils';
import { renderIsland } from '@hyperspan/framework';
import type { Hyperspan as HS } from '@hyperspan/framework';
import {
  registerIslandPlugin,
  isIslandModule,
  islandPluginResolveId,
  splitIslandId,
  registerClientChunkAliases,
  registerIslandClientUrl,
  registerRuntimeSpecifier,
  isSsrTransform,
  externalClientIslandRuntime,
  isRuntimeSpecifier,
  viteFsUrl,
  buildIslandHtmlSource,
} from '@hyperspan/vite-plugin/islands';
import debug from 'debug';
import {
  parse,
  compileScript,
  compileTemplate,
  rewriteDefault,
} from '@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js';

const log = debug('hyperspan:plugin-vue');

const VUE_ISLAND = {
  framework: 'vue',
  ext: '.vue',
  specifiers: ['vue', 'vue/dist/vue.esm-bundler.js'] as const,
  runtimePrefixes: ['vue', '@vue'] as const,
} as const;

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
  const vueClientPath = resolve(dirname(fileURLToPath(import.meta.url)), './vue-client.ts');
  let root = process.cwd();
  const { framework, ext, specifiers } = VUE_ISLAND;
  const resolveIslandId = islandPluginResolveId(framework, ext);

  return {
    name: 'hyperspan-vue',
    enforce: 'pre',

    config() {
      return {
        define: {
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
        resolve: {
          alias: {
            vue: 'vue/dist/vue.esm-bundler.js',
          },
        },
      };
    },

    configResolved(config) {
      root = config.root;
    },

    resolveId(id, importer, options) {
      const ssr = Boolean(options?.ssr) || this.environment?.name === 'ssr';
      const isRuntime = (specifier: string) =>
        isRuntimeSpecifier(specifier, VUE_ISLAND.runtimePrefixes);
      if (
        !ssr &&
        (this.environment?.mode === 'dev' || this.meta.watchMode) &&
        importer &&
        isIslandModule(importer, framework, ext) &&
        isRuntime(id)
      ) {
        return vueClientPath;
      }
      const external = externalClientIslandRuntime(
        id,
        importer,
        options,
        framework,
        ext,
        isRuntime
      );
      if (external) return external;
      return resolveIslandId.call(this, id, importer, options);
    },

    configureServer() {
      const productionUrl = `${JS_ISLAND_PUBLIC_PATH}/vue-client.js`;
      const devUrl = viteFsUrl(vueClientPath);
      for (const spec of specifiers) {
        registerRuntimeSpecifier(spec, productionUrl, { devUrl });
      }
    },

    generateBundle(_options, bundle) {
      registerClientChunkAliases(bundle, (fileName) => fileName.includes('vue-client'), specifiers);
    },

    buildStart() {
      if (this.meta.watchMode) return;
      try {
        this.emitFile({
          type: 'chunk',
          id: vueClientPath,
          fileName: '_hs/js/islands/vue-client.js',
        });
      } catch {
        // Serve mode — client is resolved via import map / Vite deps instead.
      }
    },

    async transform(code, id, options) {
      if (!isIslandModule(id, framework, ext)) return;

      log('transform vue island', id);
      const cleanId = splitIslandId(id).path;
      const jsId = assetHash(cleanId);
      const esmName = registerIslandClientUrl(cleanId, framework, root);
      const componentName = '__hs_vue_component';
      const ssr = isSsrTransform(this, options);

      const compiled = await compileVueSFC(code, cleanId, jsId, ssr);
      if (!ssr) {
        return { code: compiled, map: null };
      }

      const moduleCode = `// hyperspan:processed
${buildIslandHtmlSource}

${compiled}
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
  registerIslandPlugin({
    framework: VUE_ISLAND.framework,
    ext: VUE_ISLAND.ext,
    specifiers: VUE_ISLAND.specifiers,
    vitePlugin: vueIslandPlugin,
  });
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
