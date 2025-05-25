import { createServer } from '@hyperspan/framework';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { preactPlugin } from '@hyperspan/plugin-preact';

const app = await createServer({
  appDir: './app',
  staticFileRoot: './public',
  islandPlugins: [preactPlugin()],
});

// Any normal Hono middleware you want to use here...
app.use(trimTrailingSlash());

export default app;
