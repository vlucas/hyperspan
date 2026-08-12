import { html } from '@hyperspan/html';
import { hyperspanScriptTags, hyperspanStyleTags } from '@hyperspan/framework/layout';
import type { Hyperspan as HS } from '@hyperspan/framework';
import '../styles/globals.css';

export default function AppLayout(
  context: HS.Context,
  { title, content }: { title: string; content: any }
) {
  return html`
    <!doctype html>
    <html class="w-full h-full bg-slate-50" lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          rel="icon"
          href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>✅</text></svg>"
        />
        <title>${title}</title>
        ${hyperspanStyleTags(context)}
      </head>
      <body class="min-h-screen bg-slate-50">
        ${hyperspanScriptTags()}
        <div class="max-w-2xl mx-auto">${content}</div>
      </body>
    </html>
  `;
}
