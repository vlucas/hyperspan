import { createRoute } from '@hyperspan/framework';
import { html } from '@hyperspan/html';
import { z } from 'zod/v4';
import { validateBody } from '@hyperspan/framework/middleware/zod';

export default createRoute().get(async (c) => {
  return html`
    <html>
      <body>
        <h1>Post Page</h1>
        <p>Post ID: ${c.route.params.postId}</p>
      </body>
    </html>
  `;
}).post(async (c) => {
  return html`
    <html>
      <body>
        <h1>Post Page</h1>
        <p>Post ID: ${c.route.params.postId}</p>
      </body>
    </html>
  `;
}, {
  middleware: [validateBody(z.object({ title: z.string(), content: z.string() }))]
})