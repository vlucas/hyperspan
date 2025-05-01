import { build } from 'bun';
import { createHash } from 'node:crypto';
import { html } from '@hyperspan/html';
import { clientImportMap } from '@hyperspan/framework/assets';

const PREACT_PUBLIC_FILE_PATH = '/js/preact.min.js';

function md5(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

async function copyPreactToPublicFolder() {
  const preactClient = Bun.file(import.meta.resolve('./preact.min.js'));
  await Bun.write('./public' + PREACT_PUBLIC_FILE_PATH, preactClient);
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
    clientImportMap.set('preact', PREACT_PUBLIC_FILE_PATH);
    clientImportMap.set('preact/', PREACT_PUBLIC_FILE_PATH);
  }
  if (!clientImportMap.has('react')) {
    clientImportMap.set('react', 'https://esm.sh/preact@10.26.4/compat');
    clientImportMap.set('react-dom', 'https://esm.sh/preact@10.26.4/compat');
  }

  let resultStr = 'import{h,render}from"preact";';
  const buildResult = await build({
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
