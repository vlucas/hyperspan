import { html } from '@hyperspan/html';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createElement } from 'preact';
import { render as renderToString } from 'preact-render-to-string';

const IS_PROD = process.env.NODE_ENV === 'production';
const PWD = import.meta.dir;

export const clientImportMap = new Map<string, string>();

/**
 * Build client JS for end users (minimal JS for Hyperspan to work)
 */
export const clientJSFiles = new Map<string, { src: string; type?: string }>();
export async function buildClientJS() {
  const sourceFile = resolve(PWD, '../', './src/clientjs/hyperspan-client.ts');
  const output = await Bun.build({
    entrypoints: [sourceFile],
    outdir: `./public/_hs/js`,
    naming: IS_PROD ? '[dir]/[name]-[hash].[ext]' : undefined,
    minify: IS_PROD,
  });

  const jsFile = output.outputs[0].path.split('/').reverse()[0];

  clientJSFiles.set('_hs', { src: '/_hs/js/' + jsFile });
}

/**
 * Find client CSS file built for end users
 * @TODO: Build this in code here vs. relying on tailwindcss CLI tool from package scripts
 */
export const clientCSSFiles = new Map<string, string>();
export async function buildClientCSS() {
  if (clientCSSFiles.has('_hs')) {
    return clientCSSFiles.get('_hs');
  }

  // Find file already built from tailwindcss CLI
  const cssDir = './public/_hs/css/';
  const cssFiles = await readdir(cssDir);
  let foundCSSFile: string = '';

  for (const file of cssFiles) {
    // Only looking for CSS files
    if (!file.endsWith('.css')) {
      continue;
    }

    foundCSSFile = file.replace(cssDir, '');
    clientCSSFiles.set('_hs', foundCSSFile);
    break;
  }

  if (!foundCSSFile) {
    console.log(`Unable to build CSS files from ${cssDir}`);
  }
}

/**
 * Output HTML style tag for Hyperspan app
 */
export function hyperspanStyleTags() {
  const cssFiles = Array.from(clientCSSFiles.entries());
  return html`${cssFiles.map(
    ([_, file]) => html`<link rel="stylesheet" href="/_hs/css/${file}" />`
  )}`;
}

/**
 * Output HTML script tag for Hyperspan app
 * Required for functioning streaming so content can pop into place properly once ready
 */
export function hyperspanScriptTags() {
  const jsFiles = Array.from(clientJSFiles.entries());

  return html`
    <script type="importmap">
      {"imports": ${Object.fromEntries(clientImportMap)}}
    </script>
    ${jsFiles.map(
      ([key, file]) =>
        html`<script
          id="js-${key}"
          type="${file.type || 'text/javascript'}"
          src="${file.src}"
        ></script>`
    )}
  `;
}

function md5(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

/**
 * Build Preact client JS and copy to public folder
 */
async function copyPreactToPublicFolder() {
  const sourceFile = resolve(PWD, '../', './src/clientjs/preact.ts');
  await Bun.build({
    entrypoints: [sourceFile],
    outdir: './public/_hs/js',
    minify: true,
    format: 'esm',
    target: 'browser',
  });
}

// External ESM = https://esm.sh/preact@10.26.4/compat
const PREACT_PUBLIC_FILE_PATH = '/_hs/js/preact.js';
export const ISLAND_PUBLIC_PATH = '/_hs/js/islands';
export const ISLAND_DEFAULTS = () => ({
  ssr: false,
  inline: true,
  externals: [],
});
const ISLAND_CACHE = new Map<string, (props: any) => any>();

/**
 * Return a Preact component, mounted as an island in a <script> tag so it can be embedded into the page response.
 */
export async function createPreactIsland(
  file: string,
  options: {
    ssr?: boolean;
    inline?: boolean;
    externals?: string[];
  } = ISLAND_DEFAULTS()
) {
  let filePath = file.replace('file://', '');
  const jsId = md5(filePath + JSON.stringify(options));

  // Don't compile the same file twice!
  if (ISLAND_CACHE.has(jsId)) {
    return ISLAND_CACHE.get(jsId);
  }

  // Add Preact to client import map if not already present
  if (!clientImportMap.has('preact')) {
    await copyPreactToPublicFolder();
    clientImportMap.set('preact', '' + PREACT_PUBLIC_FILE_PATH);
    clientImportMap.set('preact/compat', '' + PREACT_PUBLIC_FILE_PATH);
    clientImportMap.set('preact/hooks', '' + PREACT_PUBLIC_FILE_PATH);
    clientImportMap.set('preact/jsx-runtime', '' + PREACT_PUBLIC_FILE_PATH);
  }
  if (!clientImportMap.has('react')) {
    clientImportMap.set('react', '.' + PREACT_PUBLIC_FILE_PATH);
    clientImportMap.set('react-dom', '.' + PREACT_PUBLIC_FILE_PATH);
  }

  options.externals = ['react', 'react-dom', 'preact', 'preact/hooks', 'preact/compat'].concat(
    options.externals || []
  );

  let resultStr = 'import{h,render}from"preact";';
  const buildResult = await Bun.build({
    outdir: options.inline ? undefined : `./public/${ISLAND_PUBLIC_PATH}`,
    entrypoints: [filePath],
    naming: IS_PROD ? '[dir]/[name]-[hash].[ext]' : undefined,
    minify: IS_PROD || options.inline,
    external: options.externals,
    splitting: true,
    env: 'APP_PUBLIC_*', // Inlines any ENV that starts with 'APP_PUBLIC_'
  });

  if (options.inline) {
    for (const output of buildResult.outputs) {
      resultStr += await output.text(); // string
    }

    // Find default export - this is our component
    const r = /export\{([a-zA-Z]+) as default\}/g;
    const matchExport = r.exec(resultStr);

    if (!matchExport) {
      console.log('resultStr', resultStr);
      throw new Error(
        'File does not have a default export! Ensure a function has export default to use this.'
      );
    }

    const fn = matchExport[1];
    let _mounted = false;

    const island = (props: any) => {
      if (!_mounted) {
        _mounted = true;
        resultStr += `render(h(${fn}, ${JSON.stringify(props)}), document.getElementById("${jsId}"));`;
      }

      if (options.inline) {
        return html.raw(
          `<div id="${jsId}"></div><script type="module" data-source-id="${jsId}">${resultStr}</script>`
        );
      }
    };

    ISLAND_CACHE.set(jsId, island);
    return island;
  }

  const islandPath = ISLAND_PUBLIC_PATH + buildResult.outputs[0].path.split(ISLAND_PUBLIC_PATH)[1];
  clientImportMap.set(jsId, islandPath);
  clientJSFiles.set(jsId, { src: islandPath, type: 'module' });

  const Component = await import(filePath);

  console.log('islandPath', {
    islandPath,
    filePath,
    jsId,
    options,
  });

  if (!Component.default) {
    throw new Error(
      'File does not have a default export! Ensure a function has export default to use this.'
    );
  }

  // Return HTML that will embed this component
  const island = (props: any) => {
    const ssrContent = renderToString(createElement(Component.default, props));
    return html.raw(
      `<div id="${jsId}">${ssrContent}</div>
       <script type="module" src="${clientImportMap.get(jsId)}"></script>
       <script type="module">
        import {h,hydrate} from "preact";
        import Component from "${jsId}";
        hydrate(h(Component, ${JSON.stringify(props)}), document.getElementById("${jsId}"));
      </script>
      `
    );
  };

  ISLAND_CACHE.set(jsId, island);
  return island;
}
