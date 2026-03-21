import { JS_IMPORT_MAP, JS_ISLAND_PUBLIC_PATH } from '@hyperspan/framework/client/js';
import { assetHash } from '@hyperspan/framework/utils';
import { IS_PROD } from '@hyperspan/framework/server';
import { join, resolve } from 'node:path';
import type { Hyperspan as HS } from '@hyperspan/framework';
import { html } from '@hyperspan/html';
import { h } from 'preact';
import { render as preactRenderToString } from 'preact-render-to-string';
import debug from 'debug';

const log = debug('hyperspan:plugin-preact');

/** Dev: stable `[name].js` via Bun default. Prod: hashed filenames for caching. */
const ISLAND_JS_NAMING = IS_PROD ? '[dir]/[name]-[hash].[ext]' : undefined;

function islandBundleBaseName(outputPath: string): string {
  return String(outputPath.split('/').reverse()[0]!.replace(/\.js$/i, ''));
}

function pickEntryPointJsOutput(
  outputs: ReadonlyArray<{ path: string; kind?: string }>,
  entrySourcePath: string
): { path: string } {
  const js = outputs.filter((o) => o.path.endsWith('.js'));
  const entry = js.find((o) => o.kind === 'entry-point');
  if (entry) return entry;
  const sourceBase = entrySourcePath.split('/').pop()!.replace(/\.(tsx|ts|jsx|js)$/i, '');
  const byName = js.find((o) => {
    const b = islandBundleBaseName(o.path);
    return b === sourceBase || b.startsWith(`${sourceBase}-`);
  });
  if (byName) return byName;
  if (js[0]) return js[0];
  throw new Error('[Hyperspan] Preact island build produced no JS output');
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
 * Render a Preact component to an HTML string (SSR).
 * Exported for direct use in tests and external tooling.
 */
export function renderPreactSSR(Component: any, props: any = {}): string {
  return preactRenderToString(h(Component, props));
}

// External ESM = https://esm.sh/preact@10.26.4/compat
type PreactIslandCacheEntry = { contents: string; esmName: string };

const PREACT_ISLAND_CACHE = new Map<string, PreactIslandCacheEntry>();

/**
 * Build Preact client JS and copy to public folder
 */
async function copyPreactToPublicFolder(config: HS.Config) {
  const currentNodeEnv = process.env.NODE_ENV || 'production';
  const sourceFile = resolve(__dirname, './preact-client.ts');

  // Preact client JS is always production mode
  process.env.NODE_ENV = 'production';
  const result = await Bun.build({
    entrypoints: [sourceFile],
    outdir: join('./', config.publicDir, JS_ISLAND_PUBLIC_PATH),
    naming: ISLAND_JS_NAMING,
    minify: true,
    format: 'esm',
    target: 'browser',
  });
  process.env.NODE_ENV = currentNodeEnv;

  const preactEntry = pickEntryPointJsOutput(result.outputs, sourceFile);
  const builtFileName = islandBundleBaseName(preactEntry.path);
  const builtFilePath = `${JS_ISLAND_PUBLIC_PATH}/${builtFileName}.js`;

  JS_IMPORT_MAP.set('preact', builtFilePath);
  JS_IMPORT_MAP.set('preact/compat', builtFilePath);
  JS_IMPORT_MAP.set('preact/hooks', builtFilePath);
  JS_IMPORT_MAP.set('preact/jsx-runtime', builtFilePath);
  JS_IMPORT_MAP.set('preact/jsx-dev-runtime', builtFilePath);

  if (!JS_IMPORT_MAP.has('react')) {
    JS_IMPORT_MAP.set('react', builtFilePath);
    JS_IMPORT_MAP.set('react-dom', builtFilePath);
  }
}

/**
 * Hyperspan Preact Plugin
 */
export function preactPlugin(): HS.Plugin {
  return async (config: HS.Config) => {
    try {
      log('plugin loaded');
      // Ensure Preact can be loaded on the client
      if (!JS_IMPORT_MAP.has('preact')) {
        await copyPreactToPublicFolder(config);
      }

      // Define a Bun plugin to handle .tsx files
      await Bun.plugin({
        name: 'Hyperspan Preact Loader',
        async setup(build) {
          // when a .tsx file is imported...
          build.onLoad({ filter: /\.tsx$/ }, async (args) => {
            log('tsx file loaded', args.path);
            const jsId = assetHash(args.path);

            if (!JS_IMPORT_MAP.has('preact')) {
              await copyPreactToPublicFolder(config);
            }

            // Cache: Avoid re-processing the same file
            if (PREACT_ISLAND_CACHE.has(jsId)) {
              const hit = PREACT_ISLAND_CACHE.get(jsId)!;
              JS_IMPORT_MAP.set(hit.esmName, `${JS_ISLAND_PUBLIC_PATH}/${hit.esmName}.js`);
              log('tsx file cached', args.path);
              return {
                contents: hit.contents,
                loader: 'js',
              };
            }

            log('tsx file not cached, building...', args.path);
            // We need to build the file to ensure we can ship it to the client with dependencies
            // Ironic, right? Calling Bun.build() inside of a plugin that runs on Bun.build()?
            const result = await Bun.build({
              entrypoints: [args.path],
              outdir: join('./', config.publicDir, JS_ISLAND_PUBLIC_PATH),
              naming: ISLAND_JS_NAMING,
              external: Array.from(JS_IMPORT_MAP.keys()),
              minify: true,
              format: 'esm',
              target: 'browser',
              env: 'APP_PUBLIC_*',
            });

            const entryOut = pickEntryPointJsOutput(result.outputs, args.path);
            const esmName = islandBundleBaseName(entryOut.path);

            // Add output file to import map
            JS_IMPORT_MAP.set(esmName, `${JS_ISLAND_PUBLIC_PATH}/${esmName}.js`);
            log('added to import map', esmName, `${JS_ISLAND_PUBLIC_PATH}/${esmName}.js`);

            let contents = await Bun.file(entryOut.path).text();

            // Look for the default export
            const RE_EXPORT_DEFAULT = /export\{([^\s]+) as default\}/;
            const RE_EXPORT_DEFAULT_FN = /export default function\s+([^\s]+)/;
            const RE_EXPORT_DEFAULT_CONST = /export default const\s+([^\s]+)/;
            const RE_EXPORT_DEFAULT_ANY = /export default\s+([^\s]+)/;

            const exportedDefault = contents.match(RE_EXPORT_DEFAULT);
            const exportedDefaultFn = contents.match(RE_EXPORT_DEFAULT_FN);
            const exportedDefaultConst = contents.match(RE_EXPORT_DEFAULT_CONST);
            const exportedDefaultAny = contents.match(RE_EXPORT_DEFAULT_ANY);

            const componentName =
              exportedDefault?.[1] ||
              exportedDefaultFn?.[1] ||
              exportedDefaultConst?.[1] ||
              exportedDefaultAny?.[1];

            if (!componentName) {
              log('ERROR: no default export found', args.path);
              throw new Error(
                `No default export found in ${args.path}. Did you forget to export a component?`
              );
            }

            // Add to contents so this is in the client JS as well
            contents = `import { h as __hs_h, render as __hs_render, hydrate as __hs_hydrate } from 'preact';${contents}`;

            // Some _interesting_ work at play here...
            // We have to modify the original file contents to add an __HS_PLUGIN export that the renderIsland() function can use to render the component.
            // A lot of this work actaully has to be done now, ahead of time, to ensure we use the same Preact instance to hydrate and render the component so there are no errors.
            // So... we have to import the preact-render-to-string library to render the component to a string here, with simple functions to do that work and return HTML.
            // All imports needed for this work are prefixed with __hs_ to avoid clashing with other imports in the module, as some of them may be duplicates.
            // Finally, we need to export all of the functions that do this work in a special way so we don't change the default export or other functions in the module, so that only the Hyperspan renderIsland() function can use them.
            const moduleCode = `// hyperspan:processed
import { render as __hs_renderToString } from 'preact-render-to-string';
import { buildIslandHtml as __hs_buildIslandHtml } from '@hyperspan/plugin-preact';

// Original file contents
${contents}

// hyperspan:preact-plugin
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
}
`;

            PREACT_ISLAND_CACHE.set(jsId, { contents: moduleCode, esmName });

            return {
              contents: moduleCode,
              loader: 'js',
            };
          });
        },
      });
    } catch (e) {
      log('ERROR: plugin build error', e);
      console.error('[Hyperspan] @hyperspan/plugin-preact build error');
      console.error(e);
      throw e;
    }
  };
}


/**
 * Render a Preact island component
 */
export function renderPreactIsland(Component: any, props: any = {}, options = {
  ssr: true,
  loading: undefined,
}) {
  // Render island with its own logic
  if (Component.__HS_ISLAND?.render) {
    return html.raw(Component.__HS_ISLAND.render(props, options));
  }

  throw new Error(
    `Module ${Component.name} was not loaded with an island plugin! Did you forget to install an island plugin and add it to the 'plugins' option in your hyperspan.config.ts file?`
  );
}