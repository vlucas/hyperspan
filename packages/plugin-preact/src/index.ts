import { clientImportMap, assetHash, ISLAND_PUBLIC_PATH } from '@hyperspan/framework/assets';
import { resolve } from 'node:path';

// External ESM = https://esm.sh/preact@10.26.4/compat
const PREACT_PUBLIC_FILE_PATH = ISLAND_PUBLIC_PATH + '/preact-client.js';
const PREACT_ISLAND_CACHE = new Map<string, string>();

/**
 * Build Preact client JS and copy to public folder
 */
async function copyPreactToPublicFolder() {
  const sourceFile = resolve(__dirname, './preact-client.ts');
  await Bun.build({
    entrypoints: [sourceFile],
    outdir: './public/' + ISLAND_PUBLIC_PATH,
    minify: true,
    format: 'esm',
    target: 'browser',
  });

  clientImportMap.set('preact', '' + PREACT_PUBLIC_FILE_PATH);
  clientImportMap.set('preact/compat', '' + PREACT_PUBLIC_FILE_PATH);
  clientImportMap.set('preact/hooks', '' + PREACT_PUBLIC_FILE_PATH);
  clientImportMap.set('preact/jsx-runtime', '' + PREACT_PUBLIC_FILE_PATH);

  if (!clientImportMap.has('react')) {
    clientImportMap.set('react', '.' + PREACT_PUBLIC_FILE_PATH);
    clientImportMap.set('react-dom', '.' + PREACT_PUBLIC_FILE_PATH);
  }
}

/**
 * Hyperspan Preact Plugin
 */
export async function preactPlugin() {
  // Define a Bun plugin to handle .tsx files
  await Bun.plugin({
    name: 'Hyperspan Preact Loader',
    async setup(build) {
      // when a .tsx file is imported...
      build.onLoad({ filter: /\.tsx$/ }, async (args) => {
        const jsId = assetHash(args.path);
        let contents = await Bun.file(args.path).text();

        // Cache: Avoid re-processing the same file
        if (PREACT_ISLAND_CACHE.has(jsId)) {
          return {
            contents: PREACT_ISLAND_CACHE.get(jsId) || '',
            loader: 'js',
          };
        }

        if (contents) {
          // We need to build the file to ensure we can ship it to the client with dependencies
          // Ironic, right? Calling Bun.build() inside of a plugin that runs on Bun.build()?
          const result = await Bun.build({
            entrypoints: [args.path],
            //outdir: './public/' + ISLAND_PUBLIC_PATH,
            //naming: '[name]-[hash].js',
            external: ['react', 'preact', 'preact/compat', 'preact/hooks', 'preact/jsx-runtime'],
            minify: true,
            format: 'esm',
            target: 'browser',
          });

          contents = await result.outputs[0].text();
        }

        // Ensure Preact can be loaded on the client
        if (!clientImportMap.has('preact')) {
          await copyPreactToPublicFolder();
        }

        // Look for the default export
        const RE_EXPORT_DEFAULT = /export\{(\w+) as default\}/;
        const RE_EXPORT_DEFAULT_FN = /export default function\s+(\w+)/;
        const RE_EXPORT_DEFAULT_CONST = /export default const\s+(\w+)/;
        const RE_EXPORT_DEFAULT_ANY = /export default\s+(\w+)/;

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
        contents = `import { h as __hs_h, render as __hs_render, hydrate as __hs_hydrate } from 'preact';${contents}`;

        // Some _interesting_ work at play here...
        // We have to modify the original file contents to add an __HS_PLUGIN export that the renderIsland() function can use to render the component.
        // A lot of this work actaully has to be done now, ahead of time, to ensure we use the same Preact instance to hydrate and render the component so there are no errors.
        // So... we have to import the preact-render-to-string library to render the component to a string here, with simple functions to do that work and return HTML.
        // All imports needed for this work are prefixed with __hs_ to avoid clashing with other imports in the module, as some of them may be duplicates.
        // Finally, we need to export all of the functions that do this work in a special way so we don't change the default export or other functions in the module, so that only the Hyperspan renderIsland() function can use them.
        const moduleCode = `// hyperspan:processed
import { html as __hs_html } from '@hyperspan/html';
import { render as __hs_renderToString } from 'preact-render-to-string';

// Original file contents
${contents}

// hyperspan:preact-plugin
${componentName}.__HS_PLUGIN = {
  ssr: (props) => {
    const ssrContent = __hs_renderToString(__hs_h(${componentName}, props));
    const postContent = \`__hs_hydrate(__hs_h(${componentName}, \${JSON.stringify(props)}), document.getElementById("${jsId}"));\`;
    return __hs_html.raw(\`<div id="${jsId}">\${ssrContent}</div><script type="module" data-source-id="${jsId}">${contents}\${postContent}</script>\`);
  },
  render: (props) => {
    const postContent = \`__hs_render(__hs_h(${componentName}, \${JSON.stringify(props)}), document.getElementById("${jsId}"));\`;
    
    return __hs_html.raw(
     \`<div id="${jsId}"></div><script type="module" data-source-id="${jsId}">${contents}\${postContent}</script>\`
    );
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
