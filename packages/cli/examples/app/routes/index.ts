import { createRoute } from '@hyperspan/framework';
import { html } from '@hyperspan/framework/html';

export default createRoute().get(() => {
  return html`
    <html>
      <body>
        <h1>Hello World</h1>
      </body>
    </html>
  `;
});
