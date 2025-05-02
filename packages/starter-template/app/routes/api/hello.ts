import { createAPIRoute } from '@hyperspan/framework';
import { sleep } from '@/src/lib/sleep';

export default createAPIRoute().get(async (c) => {
  await sleep(200);

  c.res.headers.append('X-Powered-By', 'Hyperspan');

  return { foo: 'bar' };
});
