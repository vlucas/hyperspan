import { JS_IMPORT_MAP, JS_ISLAND_PUBLIC_PATH } from '@hyperspan/framework/client/js';
import { assetHash } from '@hyperspan/framework/utils';
import { IS_PROD } from '@hyperspan/framework/server';
import { join, resolve } from 'node:path';
import type { Hyperspan as HS } from '@hyperspan/framework';
import { html } from '@hyperspan/html';
import debug from 'debug';
import { parse, compileScript, compileTemplate, rewriteDefault } from '@vue/compiler-sfc';
import './types.d';

const log = debug('hyperspan:plugin-vue');

/**
 * Build the island wrapper HTML: a div for SSR content + a module script tag for client hydration.
 * Exported so it can be imported by generated island module code and used directly in tests.
 */
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

/**
 * Render a Vue component to an HTML string (SSR).
 * Exported for direct use in tests and external tooling.
 */
export async function renderVueSSR(Component: any, props: any = {}): Promise<string> {
  const { createSSRApp } = await import('vue');
  const { renderToString } = await import('@vue/server-renderer');
  const app = createSSRApp(Component, props);
  return renderToString(app);
}

const VUE_ISLAND_CACHE = new Map<string, string>();

/**
 * Compile a Vue SFC to JavaScript using @vue/compiler-sfc.
 * Returns the combined script + template JS code ready to execute.
 */
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

  // Compile <script> / <script setup> block
  let scriptCode = 'const __sfc__ = {};';
  let bindingMetadata: Record<string, any> | undefined;
  if (descriptor.script || descriptor.scriptSetup) {
    const scriptResult = compileScript(descriptor, { id });
    bindingMetadata = scriptResult.bindings;
    // Rename `export default` to `const __sfc__ =` so we can augment it
    scriptCode = rewriteDefault(scriptResult.content, '__sfc__');
  }

  // Compile <template> block
  let templateCode = '';
  if (descriptor.template) {
    const templateResult = compileTemplate({
      source: descriptor.template.content,
      filename: filepath,
      id,
      ssr,
      scoped: descriptor.styles.some((s) => s.scoped),
      ssrCssVars: [],
      // Pass binding metadata so the template compiler knows which vars are
      // <script setup> bindings and generates $setup.x refs instead of _ctx.x
      compilerOptions: bindingMetadata ? { bindingMetadata } : undefined,
    });

    if (templateResult.errors.length) {
      throw new Error(
        `Vue SFC template errors in ${filepath}:\n${templateResult.errors.map((e) => (typeof e === 'string' ? e : e.message)).join('\n')}`
      );
    }

    templateCode = templateResult.code;
  }

  // Combine: attach render/ssrRender to the component object, then export it
  const renderKey = ssr ? 'ssrRender' : 'render';
  return `${scriptCode}\n${templateCode}\n__sfc__.${renderKey} = ${renderKey};\nexport default __sfc__;\n`;
}

/**
 * Build Vue client JS and copy to public folder
 */
async function copyVueToPublicFolder(config: HS.Config) {
  const outdir = join('./', config.publicDir, JS_ISLAND_PUBLIC_PATH);
  const devOutputFile = join(outdir, 'vue-client.js');

  // In dev mode, skip the build if the file already exists to avoid
  // conflicts with bun --watch (building vue triggers watch restarts)
  if (!IS_PROD && (await Bun.file(devOutputFile).exists())) {
    const builtFilePath = `${JS_ISLAND_PUBLIC_PATH}/vue-client.js`;
    JS_IMPORT_MAP.set('vue', builtFilePath);
    JS_IMPORT_MAP.set('vue/dist/vue.esm-bundler.js', builtFilePath);
    return;
  }

  const currentNodeEnv = process.env.NODE_ENV || 'production';
  const sourceFile = resolve(__dirname, './vue-client.ts');

  // Vue client JS is always production mode
  process.env.NODE_ENV = 'production';
  const result = await Bun.build({
    entrypoints: [sourceFile],
    outdir,
    naming: IS_PROD ? '[dir]/[name]-[hash].[ext]' : undefined,
    minify: true,
    format: 'esm',
    target: 'browser',
    define: {
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
  });
  process.env.NODE_ENV = currentNodeEnv;

  const builtFileName = String(result.outputs[0].path.split('/').reverse()[0]).replace('.js', '');
  const builtFilePath = `${JS_ISLAND_PUBLIC_PATH}/${builtFileName}.js`;

  JS_IMPORT_MAP.set('vue', builtFilePath);
  JS_IMPORT_MAP.set('vue/dist/vue.esm-bundler.js', builtFilePath);
}

/**
 * Hyperspan Vue Plugin
 */
export function vuePlugin(): HS.Plugin {
  return async (config: HS.Config) => {
    try {
      log('plugin loaded');
      // Ensure Vue can be loaded on the client
      if (!JS_IMPORT_MAP.has('vue')) {
        await copyVueToPublicFolder(config);
      }

      // Define a Bun plugin to handle .vue files
      await Bun.plugin({
        name: 'Hyperspan Vue Loader',
        async setup(build) {
          // when a .vue file is imported...
          build.onLoad({ filter: /\.vue$/ }, async (args) => {
            log('vue file loaded', args.path);
            const jsId = assetHash(args.path);

            // Cache: Avoid re-processing the same file
            if (VUE_ISLAND_CACHE.has(jsId)) {
              log('vue file cached', args.path);
              return {
                contents: VUE_ISLAND_CACHE.get(jsId) || '',
                loader: 'js',
              };
            }

            log('vue file not cached, building...', args.path);

            const source = await Bun.file(args.path).text();

            // Compile the Vue SFC for server-side rendering
            const ssrCode = await compileVueSFC(source, args.path, jsId, true);

            const outdir = join('./', config.publicDir, JS_ISLAND_PUBLIC_PATH);
            const baseName = args.path.split('/').pop()!.replace('.vue', '');

            let esmName: string;
            if (!IS_PROD) {
              // In dev mode, write compiled JS directly — avoids nested Bun.build() inside
              // Bun.plugin() onLoad which causes EISDIR conflicts under bun --watch.
              // The browser import map resolves 'vue' to vue-client.js.
              const clientCode = await compileVueSFC(source, args.path, jsId, false);
              await Bun.write(join(outdir, `${baseName}.js`), clientCode);
              esmName = baseName;
            } else {
              // Production: full bundle with tree-shaking and minification
              const vueClientPlugin = {
                name: 'vue-client-compiler',
                setup(clientBuild: any) {
                  clientBuild.onLoad(
                    { filter: /\.vue$/ },
                    async ({ path }: { path: string }) => {
                      const src = await Bun.file(path).text();
                      const clientId = assetHash(path);
                      const compiledCode = await compileVueSFC(src, path, clientId, false);
                      return { contents: compiledCode, loader: 'js' };
                    }
                  );
                },
              };

              const clientResult = await Bun.build({
                entrypoints: [args.path],
                outdir,
                naming: '[dir]/[name]-[hash].[ext]',
                external: Array.from(JS_IMPORT_MAP.keys()),
                minify: true,
                format: 'esm',
                target: 'browser',
                plugins: [vueClientPlugin],
                env: 'APP_PUBLIC_*',
                define: {
                  __VUE_OPTIONS_API__: 'true',
                  __VUE_PROD_DEVTOOLS__: 'false',
                  __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
                },
              });

              esmName = String(clientResult.outputs[0].path.split('/').reverse()[0]).replace(
                '.js',
                ''
              );
            }

            JS_IMPORT_MAP.set(esmName, `${JS_ISLAND_PUBLIC_PATH}/${esmName}.js`);
            log('added to import map', esmName, `${JS_ISLAND_PUBLIC_PATH}/${esmName}.js`);

            // Use a fixed component identifier throughout — no name extraction needed
            // since we control the SSR module code and always rename to __sfc__.
            const componentName = '__hs_vue_component';

            // Build the final module code.
            // The SSR compiled code is included inline for server-side rendering via @vue/server-renderer.
            // The client script imports the ESM bundle and uses Vue's createSSRApp for hydration.
            // Note: render() is async because Vue's renderToString() returns a Promise.
            const moduleCode = `// hyperspan:processed
function __hs_buildIslandHtml(jsId, componentName, esmName, jsContent, ssrContent, options) {
  options = options || {};
  const scriptTag = \`<script type="module" id="\${jsId}_script" data-source-id="\${jsId}">import \${componentName} from "\${esmName}";\${jsContent}</script>\`;
  if (options.loading === 'lazy') {
    return \`<div id="\${jsId}">\${ssrContent}</div><div data-loading="lazy" style="height:1px;width:1px;overflow:hidden;"><template>\\n\${scriptTag}</template></div>\`;
  }
  return \`<div id="\${jsId}">\${ssrContent}</div>\\n\${scriptTag}\`;
}

// Server-side compiled Vue component
${ssrCode}
const ${componentName} = __sfc__;

// hyperspan:vue-plugin
function __hs_renderIsland(jsContent = '', ssrContent = '', options = {}) {
  return __hs_buildIslandHtml("${jsId}", "__hs_vue_component", "${esmName}", jsContent, ssrContent, options);
}
${componentName}.__HS_ISLAND = {
  id: "${jsId}",
  render: async (props, options = {}) => {
    // Dynamic imports keep vue/server-renderer out of the static module graph
    // so the CSS-extraction bundler does not try to bundle them.
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

            VUE_ISLAND_CACHE.set(jsId, moduleCode);

            return {
              contents: moduleCode,
              loader: 'js',
            };
          });
        },
      });
    } catch (e) {
      log('ERROR: plugin build error', e);
      console.error('[Hyperspan] @hyperspan/plugin-vue build error');
      console.error(e);
      throw e;
    }
  };
}

/**
 * Render a Vue island component.
 * Returns a Promise because Vue's renderToString() is async.
 */
export async function renderVueIsland(
  Component: any,
  props: any = {},
  options = {
    ssr: true,
    loading: undefined,
  }
) {
  // Render island with its own logic
  if (Component.__HS_ISLAND?.render) {
    return html.raw(await Component.__HS_ISLAND.render(props, options));
  }

  throw new Error(
    `Module ${Component.name} was not loaded with an island plugin! Did you forget to install an island plugin and add it to the 'plugins' option in your hyperspan.config.ts file?`
  );
}
