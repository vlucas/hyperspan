import { JS_IMPORT_MAP, JS_ISLAND_PUBLIC_PATH } from '@hyperspan/framework/client/js';
import { assetHash } from '@hyperspan/framework/utils';
import { IS_PROD } from '@hyperspan/framework/server';
import { join, resolve } from 'node:path';
import type { Hyperspan as HS } from '@hyperspan/framework';
import { html } from '@hyperspan/html';
import debug from 'debug';

const log = debug('hyperspan:plugin-svelte');

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
 * Render a Svelte component to an HTML string (SSR).
 * Exported for direct use in tests and external tooling.
 */
export async function renderSvelteSSR(Component: any, props: any = {}): Promise<string> {
  const { render } = await import('svelte/server');
  return render(Component, { props }).html;
}

const SVELTE_ISLAND_CACHE = new Map<string, string>();

/**
 * Build Svelte client JS and copy to public folder
 */
async function copySvelteToPublicFolder(config: HS.Config) {
  const currentNodeEnv = process.env.NODE_ENV || 'production';
  const sourceFile = resolve(__dirname, './svelte-client.ts');

  // Svelte client JS is always production mode
  process.env.NODE_ENV = 'production';
  const result = await Bun.build({
    entrypoints: [sourceFile],
    outdir: join('./', config.publicDir, JS_ISLAND_PUBLIC_PATH),
    naming: IS_PROD ? '[dir]/[name]-[hash].[ext]' : undefined,
    minify: true,
    format: 'esm',
    target: 'browser',
  });
  process.env.NODE_ENV = currentNodeEnv;

  const builtFileName = String(result.outputs[0].path.split('/').reverse()[0]).replace('.js', '');
  const builtFilePath = `${JS_ISLAND_PUBLIC_PATH}/${builtFileName}.js`;

  JS_IMPORT_MAP.set('svelte', builtFilePath);
  JS_IMPORT_MAP.set('svelte/store', builtFilePath);
  JS_IMPORT_MAP.set('svelte/motion', builtFilePath);
  JS_IMPORT_MAP.set('svelte/transition', builtFilePath);
  JS_IMPORT_MAP.set('svelte/animate', builtFilePath);
  JS_IMPORT_MAP.set('svelte/easing', builtFilePath);
}

/**
 * Hyperspan Svelte Plugin
 */
export function sveltePlugin(): HS.Plugin {
  return async (config: HS.Config) => {
    try {
      log('plugin loaded');
      // Ensure Svelte can be loaded on the client
      if (!JS_IMPORT_MAP.has('svelte')) {
        await copySvelteToPublicFolder(config);
      }

      // Define a Bun plugin to handle .svelte files
      await Bun.plugin({
        name: 'Hyperspan Svelte Loader',
        async setup(build) {
          // when a .svelte file is imported...
          build.onLoad({ filter: /\.svelte$/ }, async (args) => {
            log('svelte file loaded', args.path);
            const jsId = assetHash(args.path);

            // Cache: Avoid re-processing the same file
            if (SVELTE_ISLAND_CACHE.has(jsId)) {
              log('svelte file cached', args.path);
              return {
                contents: SVELTE_ISLAND_CACHE.get(jsId) || '',
                loader: 'js',
              };
            }

            log('svelte file not cached, building...', args.path);

            // Compile the Svelte file for server-side rendering
            const { compile } = await import('svelte/compiler');
            const source = await Bun.file(args.path).text();

            const ssrResult = compile(source, {
              filename: args.path,
              generate: 'server',
            });

            const ssrCode = ssrResult.js.code;

            // Build the client-side bundle using an inline Svelte compiler plugin
            const svelteClientPlugin = {
              name: 'svelte-client-compiler',
              setup(clientBuild: any) {
                clientBuild.onLoad({ filter: /\.svelte$/ }, async ({ path }: { path: string }) => {
                  const src = await Bun.file(path).text();
                  const result = compile(src, {
                    filename: path,
                    generate: 'client',
                  });
                  return { contents: result.js.code, loader: 'js' };
                });
              },
            };

            // We need to build the file to ship it to the client with dependencies
            const clientResult = await Bun.build({
              entrypoints: [args.path],
              outdir: join('./', config.publicDir, JS_ISLAND_PUBLIC_PATH),
              naming: IS_PROD ? '[dir]/[name]-[hash].[ext]' : undefined,
              external: Array.from(JS_IMPORT_MAP.keys()),
              minify: true,
              format: 'esm',
              target: 'browser',
              plugins: [svelteClientPlugin],
              env: 'APP_PUBLIC_*',
            });

            // Add output file to import map
            const esmName = String(clientResult.outputs[0].path.split('/').reverse()[0]).replace(
              '.js',
              ''
            );
            JS_IMPORT_MAP.set(esmName, `${JS_ISLAND_PUBLIC_PATH}/${esmName}.js`);
            log('added to import map', esmName, `${JS_ISLAND_PUBLIC_PATH}/${esmName}.js`);

            // Extract the component name from the SSR compiled output
            const RE_EXPORT_DEFAULT = /export\{([^\s]+) as default\}/;
            const RE_EXPORT_DEFAULT_FN = /export default function\s+([^\s(]+)/;
            const RE_EXPORT_DEFAULT_ANY = /export default\s+([^\s;{]+)/;

            const exportedDefault = ssrCode.match(RE_EXPORT_DEFAULT);
            const exportedDefaultFn = ssrCode.match(RE_EXPORT_DEFAULT_FN);
            const exportedDefaultAny = ssrCode.match(RE_EXPORT_DEFAULT_ANY);

            const componentName =
              exportedDefault?.[1] || exportedDefaultFn?.[1] || exportedDefaultAny?.[1];

            if (!componentName) {
              log('ERROR: no default export found', args.path);
              throw new Error(
                `No default export found in ${args.path}. Did you forget to export a default component?`
              );
            }

            // Build the final module code.
            // The SSR compiled code is included for server-side rendering via svelte/server.
            // The client script imports the ESM bundle and uses svelte's hydrate/mount.
            const moduleCode = `// hyperspan:processed
import { render as __hs_svelte_render } from 'svelte/server';
import { buildIslandHtml as __hs_buildIslandHtml } from '@hyperspan/plugin-svelte';

// Server-side compiled Svelte component
${ssrCode}

// hyperspan:svelte-plugin
function __hs_renderIsland(jsContent = '', ssrContent = '', options = {}) {
  return __hs_buildIslandHtml("${jsId}", "${componentName}", "${esmName}", jsContent, ssrContent, options);
}
${componentName}.__HS_ISLAND = {
  id: "${jsId}",
  render: (props, options = {}) => {
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

            SVELTE_ISLAND_CACHE.set(jsId, moduleCode);

            return {
              contents: moduleCode,
              loader: 'js',
            };
          });
        },
      });
    } catch (e) {
      log('ERROR: plugin build error', e);
      console.error('[Hyperspan] @hyperspan/plugin-svelte build error');
      console.error(e);
      throw e;
    }
  };
}

/**
 * Render a Svelte island component
 */
export function renderSvelteIsland(
  Component: any,
  props: any = {},
  options = {
    ssr: true,
    loading: undefined,
  }
) {
  // Render island with its own logic
  if (Component.__HS_ISLAND?.render) {
    return html.raw(Component.__HS_ISLAND.render(props, options));
  }

  throw new Error(
    `Module ${Component.name} was not loaded with an island plugin! Did you forget to install an island plugin and add it to the 'plugins' option in your hyperspan.config.ts file?`
  );
}
