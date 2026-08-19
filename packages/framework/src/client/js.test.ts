import { describe, expect, test, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { render } from '@hyperspan/html';
import { assetHash } from '../utils';
import { setAssetManifest } from './manifest';
import {
  buildClientJS,
  discoverClientExports,
  extractExports,
  getClientJSEntries,
  registerPathAliases,
  resetClientJSEntriesForTests,
  streamingClient,
} from './js';

describe('buildClientJS', () => {
  let clientFile: string;

  beforeEach(() => {
    resetClientJSEntriesForTests();
    setAssetManifest({ imports: {}, css: {}, clients: {} });
    const dir = mkdtempSync(join(tmpdir(), 'hs-client-'));
    clientFile = join(dir, 'picker.ts');
    writeFileSync(
      clientFile,
      `export function mountPicker() {
  document.getElementById('picker')?.classList.add('ready');
}
`
    );
  });

  test('registers entry with a stable path identity', async () => {
    const result = await buildClientJS(clientFile);

    expect(result.esmName).toMatch(/^client-[0-9a-f]{16}$/);
    expect(result.publicPath).toBe(`/_hs/js/${result.esmName}.js`);
    expect(getClientJSEntries()).toHaveLength(1);
    expect(getClientJSEntries()[0].absPath).toBe(clientFile);
  });

  test('changing file contents does not change the import-map key', async () => {
    const first = await buildClientJS(clientFile);
    writeFileSync(clientFile, `export function mountPicker() { return 2; }\n`);
    resetClientJSEntriesForTests();
    const second = await buildClientJS(clientFile);
    expect(second.esmName).toBe(first.esmName);
  });

  test('publicPath uses the Vite-hashed URL from the import map', async () => {
    const result = await buildClientJS(clientFile);
    const hashed = `/_hs/js/${result.esmName}-a1b2c3d4.js`;
    setAssetManifest({
      imports: { [result.esmName]: hashed },
      css: {},
      clients: {},
    });
    expect(result.publicPath).toBe(hashed);
  });

  test('absolute path and file URL of the same file share one hash', async () => {
    const viaAbs = await buildClientJS(clientFile);
    resetClientJSEntriesForTests();
    const viaUrl = await buildClientJS(pathToFileURL(clientFile).href);
    expect(viaUrl.esmName).toBe(viaAbs.esmName);
  });

  test('renderScriptTag with no loader uses import map key', async () => {
    const result = await buildClientJS(clientFile);
    const tag = render(result.renderScriptTag());

    expect(tag).toContain(`import '${result.esmName}'`);
    expect(tag).toContain(`data-source-id="${result.assetHash}"`);
  });

  test('renderScriptTag with function inlines bootstrap code', async () => {
    const result = await buildClientJS(clientFile);
    const tag = render(
      result.renderScriptTag(({ mountPicker }: { mountPicker: () => void }) => {
        mountPicker();
      })
    );

    expect(tag).toContain(`import {mountPicker} from '${result.esmName}'`);
    expect(tag).toContain('mountPicker()');
  });

  test('renderScriptTag with string inlines bootstrap code', async () => {
    const result = await buildClientJS(clientFile);
    const tag = render(result.renderScriptTag('({ mountPicker }) => mountPicker()'));

    expect(tag).toContain('({ mountPicker }) => mountPicker()');
  });

  test('package specifiers hash the same wherever the package is installed', async () => {
    const spec = '@hyperspan/framework/client/_hs/hyperspan-streaming.client.ts';
    const first = await buildClientJS(spec, { type: 'iife' });
    resetClientJSEntriesForTests();
    const second = await buildClientJS(spec, { type: 'iife' });
    expect(first.esmName).toBe(second.esmName);
    expect(first.esmName).toBe(streamingClient.esmName);
    expect(existsSync(getClientJSEntries()[0].absPath)).toBe(true);
  });

  // workerd rejects `import.meta.resolve` after bundling, which crashed Worker startup.
  test('builtins register without resolving a path at module load', () => {
    const src = readFileSync(new URL('./js.ts', import.meta.url), 'utf8');
    const registrations = src.slice(src.indexOf('export const streamingClient'));

    expect(registrations).toContain(
      "'@hyperspan/framework/client/_hs/hyperspan-streaming.client.ts'"
    );
    expect(registrations).toContain(
      "'@hyperspan/framework/client/_hs/hyperspan-actions.client.ts'"
    );
    expect(registrations).not.toContain('import.meta.resolve');
  });

  // Valid on Node/Bun, which can resolve paths at runtime. Flagged as a path identity
  // so a Worker build can reject it instead of serving a 404 for a script in dist/.
  test('import.meta.resolve at the call site registers a real file, flagged as a path identity', async () => {
    const result = await buildClientJS(import.meta.resolve('./_hs/hyperspan-streaming.client.ts'), {
      type: 'iife',
    });

    expect(result.publicPath).toMatch(/^\/_hs\/js\/client-[0-9a-f]{16}\.js$/);
    expect(getClientJSEntries()[0].type).toBe('iife');
    expect(existsSync(getClientJSEntries()[0].absPath)).toBe(true);
    expect(getClientJSEntries()[0].absPath).toMatch(/hyperspan-streaming\.client\.ts$/);
    expect(getClientJSEntries()[0].identityFromPath).toBe(true);
  });

  test('specifier identities are not flagged as path identities', async () => {
    await buildClientJS('@hyperspan/framework/client/_hs/hyperspan-actions.client.ts');
    expect(getClientJSEntries()[0].identityFromPath).toBe(false);
  });

  test('relative paths are rejected in favor of an alias', async () => {
    await expect(buildClientJS('../client/picker.ts')).rejects.toThrow(/tsconfig alias/);
    await expect(buildClientJS('./picker.ts')).rejects.toThrow(/tsconfig alias/);
  });

  test('type iife renders a classic script tag', async () => {
    const result = await buildClientJS(clientFile, { type: 'iife' });
    const tag = render(result.renderScriptTag());

    expect(tag).toContain(`<script src="${result.publicPath}"`);
    expect(tag).not.toContain('type="module"');
    expect(getClientJSEntries()[0].type).toBe('iife');
  });

  test('logical app-relative paths hash consistently and resolve on disk when present', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hs-client-logical-'));
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, 'app/client'), { recursive: true });
    const logicalPath = join(dir, 'app/client/stats.ts');
    writeFileSync(logicalPath, `export function mountStats() {}\n`);

    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const first = await buildClientJS('app/client/stats.ts');
      resetClientJSEntriesForTests();
      const second = await buildClientJS('app/client/stats.ts');
      expect(first.esmName).toBe(second.esmName);
      expect(getClientJSEntries()[0].absPath.replace(/^\/private/, '')).toBe(
        logicalPath.replace(/^\/private/, '')
      );
    } finally {
      process.chdir(cwd);
    }
  });

  test('tsconfig aliases resolve inside buildClientJS without import.meta.resolve', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hs-client-alias-'));
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, 'app/client'), { recursive: true });
    const absPath = join(dir, 'app/client/stats.ts');
    writeFileSync(absPath, `export function mountStats() {}\n`);

    registerPathAliases({ '~/': `${dir}/`, '~': dir });

    const result = await buildClientJS('~/app/client/stats.ts');
    expect(getClientJSEntries()[0].absPath.replace(/^\/private/, '')).toBe(
      absPath.replace(/^\/private/, '')
    );
    expect(getClientJSEntries()[0].modulePath).toBe('~/app/client/stats.ts');

    resetClientJSEntriesForTests();
    registerPathAliases({ '~/': `${dir}/`, '~': dir });
    const second = await buildClientJS('~/app/client/stats.ts');
    expect(second.esmName).toBe(result.esmName);
  });

  // A Worker has no filesystem: registration must not read the source to get a URL.
  test('missing source files still resolve to the built URL', async () => {
    const spec = 'app/client/gone.ts';
    const esmName = `client-${assetHash(spec)}`;
    const hashed = `/_hs/js/${esmName}-a1b2c3d4.js`;
    setAssetManifest({ imports: { [esmName]: hashed }, css: {}, clients: {} });

    const result = await buildClientJS(spec);
    expect(result.esmName).toBe(esmName);
    expect(result.publicPath).toBe(hashed);
  });
});

describe('extractExports', () => {
  test('extracts aliased export from bundled JS content', () => {
    const contents =
      'function d(n,t){if(t)n.classList.remove("hidden");else n.classList.add("hidden")}function p(){let n=document.querySelector("[data-google-spreadsheet-id]"),t=document.querySelector("[data-google-sheet-select]"),a=document.querySelector("[data-google-sheet-message]");if(console.log("googleSheetsPickerClient",n,t),!n||!t)return;let l=(e)=>{if(!a)return;a.textContent=e||"",d(a,Boolean(e))},h=(e)=>{t.innerHTML="",e.forEach((s)=>{let o=document.createElement("option");o.value=s,o.textContent=s,t.appendChild(o)})},r=(e)=>{d(t,e),t.disabled=!e,t.required=e},c=async()=>{let e=n.value.trim();if(l(null),!e){r(!1);return}try{let s=await fetch(`/api/google-sheets/${encodeURIComponent(e)}`),o=await s.json();if(!s.ok||o.error)throw Error(o.error||"Unable to load sheet names.");let i=(o.sheets||[]).map((u)=>u.title).filter(Boolean);if(i.length===0){l("No sheets found in that spreadsheet."),r(!1);return}h(i),t.value=i[0],r(!0)}catch(s){l(s instanceof Error?s.message:"Unable to load sheet names."),r(!1)}};n.addEventListener("input",c),n.addEventListener("change",c)}export{p as mountGoogleSheetsPicker};';

    const result = extractExports(contents);

    expect(result).toEqual({
      exports: '{mountGoogleSheetsPicker}',
      fnArgs: '{mountGoogleSheetsPicker}',
    });
  });

  test('returns namespace export when none found', () => {
    const contents = 'function noop(){return 1}const value=2;';

    const result = extractExports(contents);

    expect(result).toEqual({
      exports: '* as _module',
      fnArgs: '_module',
    });
  });
});

describe('discoverClientExports', () => {
  test('discovers named exports from source', () => {
    const result = discoverClientExports(
      `export function mountPicker() {}\nexport const VERSION = 1;`
    );

    expect(result.exports).toBe('{mountPicker, VERSION}');
    expect(result.fnArgs).toBe('{mountPicker, VERSION}');
  });
});
