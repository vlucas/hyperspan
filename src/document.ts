import { html } from '@hyperspan/html';
import { clientCSSFile, clientJSFile } from './server';

export function HyperspanStyles() {
  return html`<link rel="stylesheet" href="/_hs/css/${clientCSSFile}" />`;
}

export function HyperspanScripts() {
  return html`<script src="/_hs/js/${clientJSFile}"></script>`;
}
