import { html } from '@hyperspan/html';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export type THSIslandOptions = {
  ssr?: boolean;
  loading?: 'lazy' | undefined;
};

const IS_PROD = process.env.NODE_ENV === 'production';
const PWD = import.meta.dir;

export const CLIENTJS_PUBLIC_PATH = '/_hs/js';
export const ISLAND_PUBLIC_PATH = '/_hs/js/islands';
export const clientImportMap = new Map<string, string>();

/**
 * Build client JS for end users (minimal JS for Hyperspan to work)
 */
export const clientJSFiles = new Map<string, { src: string; type?: string }>();
export async function buildClientJS() {
  const sourceFile = resolve(PWD, '../', './src/clientjs/hyperspan-client.ts');
  const output = await Bun.build({
    entrypoints: [sourceFile],
    outdir: `./public/${CLIENTJS_PUBLIC_PATH}`,
    naming: IS_PROD ? '[dir]/[name]-[hash].[ext]' : undefined,
    minify: IS_PROD,
  });

  const jsFile = output.outputs[0].path.split('/').reverse()[0];

  clientJSFiles.set('_hs', { src: `${CLIENTJS_PUBLIC_PATH}/${jsFile}` });
}

/**
 * Render a client JS module as a script tag
 */
export function renderClientJS<T>(module: T, loadScript?: ((module: T) => void) | string) {
  // @ts-ignore
  if (!module.__CLIENT_JS) {
    throw new Error(
      `[Hyperspan] Client JS was not loaded by Hyperspan! Ensure the filename ends with .client.ts to use this render method.`
    );
  }

  return html.raw(
    // @ts-ignore
    module.__CLIENT_JS.renderScriptTag({
      loadScript: loadScript
        ? typeof loadScript === 'string'
          ? loadScript
          : functionToString(loadScript)
        : undefined,
    })
  );
}

/**
 * Convert a function to a string (results in loss of context!)
 * Handles named, async, and arrow functions
 */
export function functionToString(fn: any) {
  let str = fn.toString().trim();

  // Ensure consistent output & handle async
  if (!str.includes('function ')) {
    if (str.includes('async ')) {
      str = 'async function ' + str.replace('async ', '');
    } else {
      str = 'function ' + str;
    }
  }

  const lines = str.split('\n');
  const firstLine = lines[0];
  const lastLine = lines[lines.length - 1];

  // Arrow function conversion
  if (!lastLine?.includes('}')) {
    return str.replace('=> ', '{ return ') + '; }';
  }

  // Cleanup arrow function
  if (firstLine.includes('=>')) {
    return str.replace('=> ', '');
  }

  return str;
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

export function assetHash(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

/**
 * Island defaults
 */
export const ISLAND_DEFAULTS: () => THSIslandOptions = () => ({
  ssr: true,
  loading: undefined,
});

export function renderIsland(Component: any, props: any, options = ISLAND_DEFAULTS()) {
  // Render island with its own logic
  if (Component.__HS_ISLAND?.render) {
    return html.raw(Component.__HS_ISLAND.render(props, options));
  }

  throw new Error(
    `Module ${Component.name} was not loaded with an island plugin! Did you forget to install an island plugin and add it to the createServer() 'islandPlugins' config?`
  );
}
