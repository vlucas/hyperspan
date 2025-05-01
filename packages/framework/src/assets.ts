import { html } from '@hyperspan/html';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

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

// External ESM = https://esm.sh/preact@10.26.4/compat
const PREACT_PUBLIC_FILE_PATH = '/_hs/js/preact.js';

function md5(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

/**
 * Build Preact client JS and copy to public folder
 */
async function copyPreactToPublicFolder() {
  const sourceFile = resolve(PWD, '../', './src/clientjs/preact.ts');
  const preactClient = Bun.build({
    entrypoints: [sourceFile],
    outdir: './public/_hs/js',
    minify: true,
    format: 'esm',
    target: 'browser',
  });
}

/**
 * Return a Preact component, mounted as an island in a <script> tag so it can be embedded into the page response.
 */
export async function createPreactIsland(file: string) {
  let filePath = file.replace('file://', '');
  const jsId = md5(filePath);

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

  let resultStr = 'import{h,render}from"preact";';
  const buildResult = await Bun.build({
    entrypoints: [filePath],
    minify: true,
    external: ['react', 'preact'],
    // @ts-ignore
    env: 'APP_PUBLIC_*', // Inlines any ENV that starts with 'APP_PUBLIC_'
  });

  for (const output of buildResult.outputs) {
    resultStr += await output.text(); // string
  }

  // Find default export - this is our component
  const r = /export\{([a-zA-Z]+) as default\}/g;
  const matchExport = r.exec(resultStr);

  if (!matchExport) {
    throw new Error(
      'File does not have a default export! Ensure a function has export default to use this.'
    );
  }

  // Preact render/mount component
  const fn = matchExport[1];
  let _mounted = false;

  // Return HTML that will embed this component
  return (props: any) => {
    if (!_mounted) {
      _mounted = true;
      resultStr += `render(h(${fn}, ${JSON.stringify(props)}), document.getElementById("${jsId}"));`;
    }
    return html.raw(
      `<div id="${jsId}"></div><script type="module" data-source-id="${jsId}">${resultStr}</script>`
    );
  };
}
