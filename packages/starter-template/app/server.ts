import hyperspanConfig from '../hyperspan.config';
import { createServer } from '@hyperspan/framework';
import { trimTrailingSlash } from 'hono/trailing-slash';

const app = await createServer(hyperspanConfig);

// Any normal Hono middleware you want to use here...
app.use(trimTrailingSlash());

export default app;
