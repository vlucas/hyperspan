import { createRoute } from '@hyperspan/framework';
import { html } from '@hyperspan/html';
import { z } from 'zod/v4';

export default createRoute().get(async (c) => {
  return html`
    <html>
      <body>
        <h1>Post Page</h1>
        <p>Post ID: ${c.req.params.postId}</p>
      </body>
    </html>
  `;
}).post(async (c) => {
  return html`
    <html>
      <body>
        <h1>Post Page</h1>
        <p>Post ID: ${c.req.params.postId}</p>
      </body>
    </html>
  `;
}, { validateBody: z.object({ title: z.string(), content: z.string() }) });