import { JS_IMPORT_MAP, JS_ISLAND_PUBLIC_PATH } from '@hyperspan/framework/client/js';
import { assetHash } from '@hyperspan/framework/utils';
import { IS_PROD } from '@hyperspan/framework/server';
import { join, resolve } from 'node:path';
import type { Hyperspan as HS } from '@hyperspan/framework';
import { html } from '@hyperspan/html';
import debug from 'debug';
import { compile } from 'svelte/compiler';
import './types.d';

const log = debug('hyperspan:plugin-svelte');

/** Import specifiers that resolve to the unified Svelte browser bundle (one closure for hydration state). */
const SVELTE_CLIENT_BUNDLE_SPECIFIERS = [
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

function registerSvelteClientBundle(publicPath: string) {
  for (const specifier of SVELTE_CLIENT_BUNDLE_SPECIFIERS) {
    JS_IMPORT_MAP.set(specifier, publicPath);
  }
}

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
  const outdir = join('./', config.publicDir, JS_ISLAND_PUBLIC_PATH);
  const devClientBundleFile = join(outdir, 'svelte-client.js');

  // In dev mode, skip the build if the file already exists to avoid
  // conflicts with bun --watch (building svelte triggers watch restarts)
  if (!IS_PROD && (await Bun.file(devClientBundleFile).exists())) {
    registerSvelteClientBundle(`${JS_ISLAND_PUBLIC_PATH}/svelte-client.js`);
    return;
  }

  const currentNodeEnv = process.env.NODE_ENV || 'production';
  const internalSourceFile = resolve(__dirname, './svelte-client.ts');

  // Build one unified bundle: svelte/internal/client + svelte public API + svelte/store.
  process.env.NODE_ENV = 'production';
  const internalResult = await Bun.build({
    entrypoints: [internalSourceFile],
    outdir,
    naming: IS_PROD ? '[dir]/[name]-[hash].[ext]' : undefined,
    minify: true,
    format: 'esm',
    target: 'browser',
  });
  process.env.NODE_ENV = currentNodeEnv;

  const internalFileName = String(internalResult.outputs[0].path.split('/').reverse()[0]).replace('.js', '');
  const internalFilePath = `${JS_ISLAND_PUBLIC_PATH}/${internalFileName}.js`;

  registerSvelteClientBundle(internalFilePath);
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
            const source = await Bun.file(args.path).text();

            const ssrResult = compile(source, {
              filename: args.path,
              generate: 'server',
            });

            const ssrCode = ssrResult.js.code;

            const outdir = join('./', config.publicDir, JS_ISLAND_PUBLIC_PATH);
            const baseName = args.path.split('/').pop()!.replace('.svelte', '');

            let esmName: string;
            if (!IS_PROD) {
              // In dev mode, write compiled JS directly — avoids nested Bun.build() inside
              // Bun.plugin() onLoad which causes EISDIR conflicts under bun --watch.
              // The browser import map resolves 'svelte' to svelte-client.js.
              const clientResult = compile(source, {
                filename: args.path,
                generate: 'client',
              });
              await Bun.write(join(outdir, `${baseName}.js`), clientResult.js.code);
              esmName = baseName;
            } else {
              // Production: full bundle with tree-shaking and minification
              const svelteClientPlugin = {
                name: 'svelte-client-compiler',
                setup(clientBuild: any) {
                  clientBuild.onLoad(
                    { filter: /\.svelte$/ },
                    async ({ path }: { path: string }) => {
                      const src = await Bun.file(path).text();
                      const result = compile(src, { filename: path, generate: 'client' });
                      return { contents: result.js.code, loader: 'js' };
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
                plugins: [svelteClientPlugin],
                env: 'APP_PUBLIC_*',
              });

              esmName = String(clientResult.outputs[0].path.split('/').reverse()[0]).replace(
                '.js',
                ''
              );
            }

            // Add output file to import map
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
function __hs_buildIslandHtml(jsId, componentName, esmName, jsContent, ssrContent, options) {
  options = options || {};
  const scriptTag = \`<script type="module" id="\${jsId}_script" data-source-id="\${jsId}">import \${componentName} from "\${esmName}";\${jsContent}</script>\`;
  if (options.loading === 'lazy') {
    return \`<div id="\${jsId}">\${ssrContent}</div><div data-loading="lazy" style="height:1px;width:1px;overflow:hidden;"><template>\\n\${scriptTag}</template></div>\`;
  }
  return \`<div id="\${jsId}">\${ssrContent}</div>\\n\${scriptTag}\`;
}

// Server-side compiled Svelte component
${ssrCode}

// hyperspan:svelte-plugin
function __hs_renderIsland(jsContent = '', ssrContent = '', options = {}) {
  return __hs_buildIslandHtml("${jsId}", "${componentName}", "${esmName}", jsContent, ssrContent, options);
}
${componentName}.__HS_ISLAND = {
  id: "${jsId}",
  render: async (props, options = {}) => {
    // Dynamic import keeps svelte/server out of the static module graph
    // so the CSS-extraction bundler does not try to bundle it.
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
export async function renderSvelteIsland(
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
