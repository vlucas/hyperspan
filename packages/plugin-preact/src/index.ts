import { clientImportMap, assetHash, ISLAND_PUBLIC_PATH } from '@hyperspan/framework/assets';
import { IS_PROD } from '@hyperspan/framework/server';
import { resolve } from 'node:path';

// External ESM = https://esm.sh/preact@10.26.4/compat
const PREACT_ISLAND_CACHE = new Map<string, string>();

/**
 * Build Preact client JS and copy to public folder
 */
async function copyPreactToPublicFolder() {
  const sourceFile = resolve(__dirname, './preact-client.ts');
  const result = await Bun.build({
    entrypoints: [sourceFile],
    outdir: `./public/${ISLAND_PUBLIC_PATH}`,
    naming: IS_PROD ? '[dir]/[name]-[hash].[ext]' : undefined,
    minify: true,
    format: 'esm',
    target: 'browser',
  });

  const builtFileName = String(result.outputs[0].path.split('/').reverse()[0]).replace('.js', '');
  const builtFilePath = `${ISLAND_PUBLIC_PATH}/${builtFileName}.js`;

  clientImportMap.set('preact', builtFilePath);
  clientImportMap.set('preact/compat', builtFilePath);
  clientImportMap.set('preact/hooks', builtFilePath);
  clientImportMap.set('preact/jsx-runtime', builtFilePath);

  if (!clientImportMap.has('react')) {
    clientImportMap.set('react', builtFilePath);
    clientImportMap.set('react-dom', builtFilePath);
  }
}

/**
 * Hyperspan Preact Plugin
 */
export async function preactPlugin() {
  // Ensure Preact can be loaded on the client
  if (!clientImportMap.has('preact')) {
    await copyPreactToPublicFolder();
  }

  // Define a Bun plugin to handle .tsx files
  await Bun.plugin({
    name: 'Hyperspan Preact Loader',
    async setup(build) {
      // when a .tsx file is imported...
      build.onLoad({ filter: /\.tsx$/ }, async (args) => {
        const jsId = assetHash(args.path);

        // Cache: Avoid re-processing the same file
        if (PREACT_ISLAND_CACHE.has(jsId)) {
          return {
            contents: PREACT_ISLAND_CACHE.get(jsId) || '',
            loader: 'js',
          };
        }

        // We need to build the file to ensure we can ship it to the client with dependencies
        // Ironic, right? Calling Bun.build() inside of a plugin that runs on Bun.build()?
        const result = await Bun.build({
          entrypoints: [args.path],
          outdir: `./public/${ISLAND_PUBLIC_PATH}`,
          naming: IS_PROD ? '[dir]/[name]-[hash].[ext]' : undefined,
          external: Array.from(clientImportMap.keys()),
          minify: true,
          format: 'esm',
          target: 'browser',
          env: 'APP_PUBLIC_*',
        });

        // Add output file to import map
        const esmName = String(result.outputs[0].path.split('/').reverse()[0]).replace('.js', '');
        clientImportMap.set(esmName, `${ISLAND_PUBLIC_PATH}/${esmName}.js`);

        let contents = await result.outputs[0].text();

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
          throw new Error(
            `No default export found in ${args.path}. Did you forget to export a component?`
          );
        }

        // Add to contents so this is in the client JS as well
        contents = `import { h, h as __hs_h, render as __hs_render, hydrate as __hs_hydrate } from 'preact';${contents}`;

        // Some _interesting_ work at play here...
        // We have to modify the original file contents to add an __HS_PLUGIN export that the renderIsland() function can use to render the component.
        // A lot of this work actaully has to be done now, ahead of time, to ensure we use the same Preact instance to hydrate and render the component so there are no errors.
        // So... we have to import the preact-render-to-string library to render the component to a string here, with simple functions to do that work and return HTML.
        // All imports needed for this work are prefixed with __hs_ to avoid clashing with other imports in the module, as some of them may be duplicates.
        // Finally, we need to export all of the functions that do this work in a special way so we don't change the default export or other functions in the module, so that only the Hyperspan renderIsland() function can use them.
        const moduleCode = `// hyperspan:processed
import { render as __hs_renderToString } from 'preact-render-to-string';

// Original file contents
${contents}

// hyperspan:preact-plugin
function __hs_renderIsland(jsContent = '', ssrContent = '', options = {}) {
  const scriptTag = \`<script type="module" id="${jsId}_script" data-source-id="${jsId}">import ${componentName} from "${esmName}";\${jsContent}</script>\`;
  if (options.loading === 'lazy') {
    return \`<div id="${jsId}">\${ssrContent}</div><div data-loading="lazy" style="height:1px;width:1px;overflow:hidden;"><template>\n\${scriptTag}</template></div>\`;
  }

  return \`<div id="${jsId}">\${ssrContent}</div>\n\${scriptTag}\`;
}
${componentName}.__HS_ISLAND = {
  id: "${jsId}",
  render: (props, options = {}) => {
    if (options.ssr === false) {
      const jsContent = \`__hs_render(__hs_h(${componentName}, \${JSON.stringify(props)}), document.getElementById("${jsId}"));\`;
      return __hs_renderIsland(jsContent, '', options);
    }

    const ssrContent = __hs_renderToString(__hs_h(${componentName}, props));
    const jsContent = \`__hs_hydrate(__hs_h(${componentName}, \${JSON.stringify(props)}), document.getElementById("${jsId}"));\`;
    return __hs_renderIsland(jsContent, ssrContent, options);
    
  }
}
`;

        PREACT_ISLAND_CACHE.set(jsId, moduleCode);

        return {
          contents: moduleCode,
          loader: 'js',
        };
      });
    },
  });
}
