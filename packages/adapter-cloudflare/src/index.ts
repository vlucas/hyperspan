import {
  createFetchHandler,
  type Adapter,
  type DeployEntry,
  type DeployEntryContext,
  type FetchHandlerOptions,
} from '@hyperspan/framework';
import type { Hyperspan as HS } from '@hyperspan/framework';
import { syncWranglerCssAliases } from './deploy/sync-wrangler-css-aliases';

type CloudflareAdapterOptions = FetchHandlerOptions & {
  assets?: { fetch: (request: Request) => Promise<Response> };
};

function createCloudflareHandler(server: HS.Server, options: CloudflareAdapterOptions = {}) {
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

export function createCloudflareDeployEntry(ctx: DeployEntryContext): DeployEntry {
  let appPromise: ReturnType<typeof createCloudflareHandler> | null = null;

  return {
    async fetch(request: Request, env: unknown): Promise<Response> {
      appPromise ??= (async () => {
        const server = await ctx.createHyperspanServer({ env });
        const { ASSETS } = env as {
          ASSETS?: { fetch: (request: Request) => Promise<Response> };
        };
        return createCloudflareHandler(server, { assets: ASSETS });
      })();
      const app = await appPromise;
      return app.fetch(request);
    },
  };
}

/**
 * Cloudflare Workers deployment adapter. Pass to `deployAdapter` in hyperspan.config.ts.
 */
export function cloudflareAdapter(): Adapter {
  return {
    name: 'cloudflare',
    devModule: '@hyperspan/adapter-cloudflare/dev',
    renderServerEntry: (template) =>
      template({
        beforeFileContent: `import '@hyperspan/adapter-cloudflare/polyfills';
import { createCloudflareDeployEntry } from '@hyperspan/adapter-cloudflare';`,
        afterFileContent: `export default createCloudflareDeployEntry({
  createHyperspanServer,
  config: hyperspanConfig,
});
`,
      }),
    afterBuild({ root, appDir }) {
      const css = syncWranglerCssAliases(root, { appDir });
      if (css.updated) {
        console.log(
          `[Hyperspan] Synced Wrangler CSS aliases (${css.aliasCount}) for Cloudflare deploy`
        );
      }
    },
  };
}
