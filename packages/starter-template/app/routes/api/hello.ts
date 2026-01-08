import { createRoute } from '@hyperspan/framework';
import { sleep } from '@/src/lib/sleep';

export default createRoute().get(async (context) => {
  await sleep(200);

  context.res.headers.append('X-Powered-By', 'Hyperspan');

  return Response.json({ foo: 'bar' });
});
