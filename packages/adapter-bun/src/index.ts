import { join } from 'node:path';
import { createFetchHandler, type FetchHandlerOptions } from '@hyperspan/framework';
import type { Hyperspan as HS } from '@hyperspan/framework';

export type BunAdapterOptions = FetchHandlerOptions & {
  port?: number;
  development?: boolean;
};

/**
 * Start a Bun HTTP server using the portable fetch handler.
 */
export function startBunServer(server: HS.Server, options: BunAdapterOptions = {}) {
  const publicDir = server._config.publicDir || './public';

  const fetch = createFetchHandler(server, {
    ...options,
    onNotMatched: async (request) => {
      const url = new URL(request.url);
      const file = Bun.file(join('./', publicDir, url.pathname));
      if (await file.exists()) {
        return new Response(file);
      }
      return options.onNotMatched?.(request);
    },
  });

  const httpServer = Bun.serve({
    development: options.development ?? process.env.NODE_ENV === 'development',
    port: options.port,
    fetch,
  });

  return httpServer;
}

export { createFetchHandler };
