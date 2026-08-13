import { join } from 'node:path';
import {
  createFetchHandler,
  type Adapter,
  type DeployEntry,
  type DeployEntryContext,
  type FetchHandlerOptions,
} from '@hyperspan/framework';
import type { Hyperspan as HS } from '@hyperspan/framework';

type BunAdapterOptions = FetchHandlerOptions & {
  port?: number;
  development?: boolean;
};

function startBunServer(server: HS.Server, options: BunAdapterOptions = {}) {
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

function createBunDeployEntry(ctx: DeployEntryContext): DeployEntry {
  return {
    async start(options: { port?: number } = {}) {
      if (ctx.config.beforeServerCreate) {
        await ctx.config.beforeServerCreate({ env: process.env });
      }
      const server = await ctx.createHyperspanServer();
      return startBunServer(server, { port: options.port ?? 3000 });
    },
  };
}

/**
 * Bun deployment adapter. Pass to `deployAdapter` in hyperspan.config.ts.
 */
export function bunAdapter(): Adapter {
  return {
    name: 'bun',
    createEntry: createBunDeployEntry,
  };
}
