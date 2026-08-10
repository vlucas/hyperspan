import { describe, expect, test, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { render } from '@hyperspan/html';
import {
  buildClientJS,
  discoverClientExports,
  extractExports,
  getClientJSEntries,
  resetClientJSEntriesForTests,
} from './js';

describe('buildClientJS', () => {
  let clientFile: string;

  beforeEach(() => {
    resetClientJSEntriesForTests();
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

  test('registers entry and returns stable esmName from path hash', async () => {
    const result = await buildClientJS(clientFile);

    expect(result.esmName).toMatch(/^client-[0-9a-f]{16}$/);
    expect(result.publicPath).toBe(`/_hs/js/${result.esmName}.js`);
    expect(getClientJSEntries()).toHaveLength(1);
    expect(getClientJSEntries()[0].absPath).toBe(clientFile);
  });

  test('renderScriptTag with no loader uses import map key', async () => {
    const result = await buildClientJS(clientFile);
    const tag = render(result.renderScriptTag());

    expect(tag).toContain(`import "${result.esmName}"`);
    expect(tag).toContain(`data-source-id="${result.assetHash}"`);
  });

  test('renderScriptTag with function inlines bootstrap code', async () => {
    const result = await buildClientJS(clientFile);
    const tag = render(
      result.renderScriptTag(({ mountPicker }: { mountPicker: () => void }) => {
        mountPicker();
      })
    );

    expect(tag).toContain(`import {mountPicker} from "${result.esmName}"`);
    expect(tag).toContain('mountPicker()');
  });

  test('renderScriptTag with string inlines bootstrap code', async () => {
    const result = await buildClientJS(clientFile);
    const tag = render(result.renderScriptTag('({ mountPicker }) => mountPicker()'));

    expect(tag).toContain('({ mountPicker }) => mountPicker()');
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
