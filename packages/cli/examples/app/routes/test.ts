import { createRoute } from '@hyperspan/framework';
import { html } from '@hyperspan/html';

export default createRoute().get(async (c) => {
  return html`
    <html>
      <body>
        <h1>Test Page</h1>
      </body>
    </html>
  `;
});