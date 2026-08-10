import { createFetchHandler, type FetchHandlerOptions } from '@hyperspan/framework';
import type { Hyperspan as HS } from '@hyperspan/framework';

export type CloudflareAdapterOptions = FetchHandlerOptions & {
  /** Cloudflare Assets binding or static asset fetcher */
  assets?: { fetch: (request: Request) => Promise<Response> };
};

/**
 * Create a Cloudflare Workers fetch handler for a Hyperspan app.
 *
 * Usage:
 * ```ts
 * import { createApp } from '@hyperspan/framework';
 * import { createCloudflareHandler } from '@hyperspan/adapter-cloudflare';
 * import server from './dist/server';
 *
 * const { fetch } = createCloudflareHandler(server, { assets: env.ASSETS });
 * export default { fetch };
 * ```
 */
export function createCloudflareHandler(server: HS.Server, options: CloudflareAdapterOptions = {}) {
  const fetch = createFetchHandler(server, {
    ...options,
    onNotMatched: async (request) => {
      if (options.assets) {
        const assetResponse = await options.assets.fetch(request);
        if (assetResponse.status !== 404) {
          return assetResponse;
        }
      }
      return options.onNotMatched?.(request);
    },
  });

  return { fetch, server };
}

export { createFetchHandler };
