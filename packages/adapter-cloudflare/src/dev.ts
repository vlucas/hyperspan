import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type ResolveCloudflareDevEnvOptions = {
  /** Explicit Wrangler config path. When omitted, common local filenames are tried. */
  configPath?: string;
};

/**
 * Prefer a local-only Wrangler config when present (no containers / lighter bindings).
 */
export function findWranglerConfigPath(root: string): string | undefined {
  return [
    join(root, 'wrangler.dev.jsonc'),
    join(root, 'wrangler.dev.toml'),
    join(root, 'wrangler.toml'),
    join(root, 'wrangler.jsonc'),
  ].find((path) => existsSync(path));
}

type PlatformProxy = {
  env: unknown;
  dispose?: () => Promise<void>;
};

/** One Miniflare/workerd per Wrangler config — a second proxy locks local D1 (SQLITE_BUSY). */
const proxyByConfig = new Map<string, Promise<PlatformProxy>>();

function proxyCacheKey(root: string, configPath?: string): string {
  return configPath ?? join(root, ':default');
}

/**
 * Resolve Cloudflare bindings for Vite/`hyperspan dev` via Wrangler's platform proxy.
 *
 * Must run in a native Node module context (e.g. the Vite plugin), not under jiti/vm —
 * `import('wrangler')` fails there.
 */
export async function resolveDevEnv(
  root: string,
  options: ResolveCloudflareDevEnvOptions = {}
): Promise<unknown> {
  const configPath = options.configPath ?? findWranglerConfigPath(root);
  const key = proxyCacheKey(root, configPath);

  let pending = proxyByConfig.get(key);
  if (!pending) {
    pending = (async () => {
      const { getPlatformProxy } = await import('wrangler');
      return getPlatformProxy(configPath ? { configPath } : {}) as Promise<PlatformProxy>;
    })();
    proxyByConfig.set(key, pending);
    pending.catch(() => {
      proxyByConfig.delete(key);
    });
  }

  try {
    const proxy = await pending;
    return proxy.env;
  } catch (err) {
    console.warn(
      '[Hyperspan] Could not load Cloudflare bindings via Wrangler for Vite/dev.',
      'Install wrangler and ensure a wrangler.toml (or wrangler.dev.jsonc) exists.',
      '\n',
      err
    );
    return process.env;
  }
}
