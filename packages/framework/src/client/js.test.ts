import { describe, expect, test } from 'bun:test';
import { extractExports } from './js';

describe('extractExports', () => {
  test('extracts aliased export from bundled JS content', () => {
    const contents = 'function d(n,t){if(t)n.classList.remove("hidden");else n.classList.add("hidden")}function p(){let n=document.querySelector("[data-google-spreadsheet-id]"),t=document.querySelector("[data-google-sheet-select]"),a=document.querySelector("[data-google-sheet-message]");if(console.log("googleSheetsPickerClient",n,t),!n||!t)return;let l=(e)=>{if(!a)return;a.textContent=e||"",d(a,Boolean(e))},h=(e)=>{t.innerHTML="",e.forEach((s)=>{let o=document.createElement("option");o.value=s,o.textContent=s,t.appendChild(o)})},r=(e)=>{d(t,e),t.disabled=!e,t.required=e},c=async()=>{let e=n.value.trim();if(l(null),!e){r(!1);return}try{let s=await fetch(`/api/google-sheets/${encodeURIComponent(e)}`),o=await s.json();if(!s.ok||o.error)throw Error(o.error||"Unable to load sheet names.");let i=(o.sheets||[]).map((u)=>u.title).filter(Boolean);if(i.length===0){l("No sheets found in that spreadsheet."),r(!1);return}h(i),t.value=i[0],r(!0)}catch(s){l(s instanceof Error?s.message:"Unable to load sheet names."),r(!1)}};n.addEventListener("input",c),n.addEventListener("change",c)}export{p as mountGoogleSheetsPicker};';

    const result = extractExports(contents);

    expect(result).toEqual({
      exports: '{mountGoogleSheetsPicker}',
      fnArgs: '{mountGoogleSheetsPicker}',
    });
  });

  test('returns empty exports when none found', () => {
    const contents = 'function noop(){return 1}const value=2;';

    const result = extractExports(contents);

    expect(result).toEqual({
      exports: '* as _module',
      fnArgs: '_module',
    });
  });
});

