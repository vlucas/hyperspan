import { html } from '@hyperspan/html';
import { hyperspanScriptTags, hyperspanStyleTags } from '@hyperspan/framework/assets';

export default function MarketingLayout({ title, content }: { title: string; content: any }) {
  return html`
    <!DOCTYPE html>
    <html class="w-full h-full" lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          rel="icon"
          href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🚀</text></svg>"
        />

        <title>${title}</title>
        ${hyperspanStyleTags()}
      </head>
      <body>
        ${hyperspanScriptTags()}
        <div class="max-w-5xl m-auto my-8">
          <div class="h-full">${content}</div>
          <footer class="bg-base-200 p-8 mt-10">
            <p class="block my-20 text-sm">
              Powered by
              <a href="https://www.hyperspan.dev">Hyperspan</a> &copy; ${new Date().getFullYear()}.
            </p>
          </footer>
        </div>
      </body>
    </html>
  `;
}
