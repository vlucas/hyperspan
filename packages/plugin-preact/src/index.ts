import { clientImportMap, assetHash } from '@hyperspan/framework/assets';
import { resolve } from 'node:path';

const IS_PROD = process.env.NODE_ENV === 'production';
const PWD = process.cwd();
// External ESM = https://esm.sh/preact@10.26.4/compat
const PREACT_PUBLIC_FILE_PATH = '/_hs/js/islands/preact-client.js';
export const ISLAND_PUBLIC_PATH = '/_hs/js/islands';
export const ISLAND_DEFAULTS = () => ({
  ssr: false,
  inline: true,
  externals: [],
});
const ISLAND_CACHE = new Map<string, (props: any) => any>();

/**
 * Build Preact client JS and copy to public folder
 */
async function copyPreactToPublicFolder() {
  const sourceFile = resolve(__dirname, './preact-client.ts');
  await Bun.build({
    entrypoints: [sourceFile],
    outdir: './public/_hs/js/islands',
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
const processedCache = new Map<string, string>();
export async function preactPlugin() {
  // Use Bun Transpiler to introspect and compile the file contents
  // @link https://bun.sh/docs/api/transpiler
  const transpiler = new Bun.Transpiler({
    loader: 'tsx',
    tsconfig: {
      compilerOptions: {
        jsx: 'react',
        jsxFactory: 'h',
        jsxFragmentFactory: 'Fragment',
      },
    },
  });

  // Define a Bun plugin to handle .tsx files
  await Bun.plugin({
    name: 'Hyperspan Preact Loader',
    async setup(build) {
      // when a .tsx file is imported...
      build.onLoad({ filter: /\.tsx$/ }, async (args) => {
        const jsId = assetHash(args.path);
        let contents = await Bun.file(args.path).text();

        // Cache: Avoid re-processing the same file
        if (processedCache.has(jsId)) {
          return {
            contents: processedCache.get(jsId) || '',
            loader: 'js',
          };
        }

        if (contents) {
          contents = transpiler.transformSync(contents);
        }

        // Ensure Preact can be loaded on the client
        if (!clientImportMap.has('preact')) {
          await copyPreactToPublicFolder();
        }

        // Look for the default export
        const RE_EXPORT_DEFAULT = /export\{([a-zA-Z]+) as default\}/;
        const RE_EXPORT_DEFAULT_FN = /export default function\s+([a-zA-Z]+)/;
        const RE_EXPORT_DEFAULT_CONST = /export default const\s+([a-zA-Z]+)/;
        const RE_EXPORT_DEFAULT_ANY = /export default\s+([a-zA-Z]+)/;

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

        contents = `import { h as __hs_h, render as __hs_render, Fragment as __hs_Fragment, hydrate as __hs_hydrate } from 'preact';\n${contents}`;

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
    const postContent = \`__hs_render(h(${componentName}, \${JSON.stringify(props)}), document.getElementById("${jsId}"));\`;
    
    return __hs_html.raw(
     \`<div id="${jsId}"></div><script type="module" data-source-id="${jsId}">${contents}\${postContent}</script>\`
    );
  }
}
`;

        processedCache.set(jsId, moduleCode);

        return {
          contents: moduleCode,
          loader: 'js',
        };
      });
    },
  });
}
