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

  try {
    const { getPlatformProxy } = await import('wrangler');
    const proxy = await getPlatformProxy(configPath ? { configPath } : {});
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
