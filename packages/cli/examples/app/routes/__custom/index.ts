import { createRoute } from "@hyperspan/framework";
import { html } from "@hyperspan/html";

// This should NOT be a route, because it is in a directory that starts with a double underscore (__custom)
export default createRoute().get(async (c) => {
  return html`
    <html>
      <body>
        <h1>Inaccessible Route</h1>
        <p>This route is not accessible because it is in a directory that starts with a double underscore (<code>__custom</code>).</p>
      </body>
    </html>
  `;
});