import { html } from '@hyperspan/html';
import { clientImportMap } from './clientjs';

export function hyperspanScriptTags() {
  return html`
    <script type="importmap">
      {"imports": ${Object.fromEntries(clientImportMap)}}
    </script>
  `;
}

export function hyperspanStyleTags() {
  return html`
    <link rel="stylesheet" href="/_hs/css/styles.css" />
  `;
}