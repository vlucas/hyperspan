import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import {
  getClientJSEntries,
  getClientJSEntryByEsmName,
  JS_PUBLIC_PATH,
  type ClientJSEntry,
} from '@hyperspan/framework/client/js';
import { registerImport } from '@hyperspan/framework/client/manifest';
import { resolveModuleAliases } from './tsconfig-aliases';

function publicClientJSPath(id: string): string | null {
  const path = id.split('?')[0].replace(/\\/g, '/');
  const marker = `${JS_PUBLIC_PATH}/`;
  const idx = path.lastIndexOf(marker);
  if (idx === -1 || !path.endsWith('.js')) {
    return null;
  }
  return path.slice(idx);
}

export function resolveClientJSSource(id: string): string | null {
  const publicPath = publicClientJSPath(id);
  if (!publicPath) {
    return null;
  }

  const fileName = basename(publicPath);
  if (!fileName.startsWith('client-')) {
    return null;
  }

  const entry = getClientJSEntryByEsmName(basename(fileName, '.js'));
  if (!entry || !existsSync(entry.absPath)) {
    return null;
  }
  return entry.absPath;
}

/** Rollup input for ESM `buildClientJS` entries (IIFE clients are emitted as assets). */
export function clientJSRollupInput(): Record<string, string> {
  return Object.fromEntries(
    getClientJSEntries()
      .filter((entry) => entry.type === 'module' && existsSync(entry.absPath))
      .map((entry) => [entry.esmName, entry.absPath])
  );
}

/**
 * Bundle a `buildClientJS(..., { type: 'iife' })` entry as a classic script (no import/export).
 */
export async function bundleIifeClientJS(
  absPath: string,
  options: { minify?: boolean } = {}
): Promise<string> {
  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    absWorkingDir: dirname(absPath),
    entryPoints: [absPath],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    minify: options.minify ?? false,
    logLevel: 'silent',
  });
  const code = result.outputFiles?.[0]?.text;
  if (!code) {
    throw new Error(`[Hyperspan] Failed to bundle IIFE client script: ${absPath}`);
  }
  return code;
}

function toViteTransformUrl(absPath: string, root: string): string {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
  const normalized = absPath.replace(/\\/g, '/');
  if (normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`)) {
    return normalized.slice(normalizedRoot.length) || '/';
  }
  return `/@fs${normalized}`;
}

export function clientJSPlugin(): Plugin {
  let command: 'build' | 'serve' = 'serve';

  return {
    name: 'hyperspan-client-js',
    enforce: 'pre',

    configResolved(config) {
      command = config.command;
    },

    resolveId(id) {
      return resolveClientJSSource(id);
    },

    async buildStart() {
      for (const entry of getClientJSEntries()) {
        if (entry.type === 'iife' || !existsSync(entry.absPath)) continue;
        try {
          this.emitFile({
            type: 'chunk',
            id: entry.absPath,
            fileName: `_hs/js/${entry.esmName}.js`,
          });
        } catch {
          // Serve mode — client modules are resolved via Vite resolveId/load.
        }
      }

      if (command !== 'build') return;
      for (const entry of getClientJSEntries()) {
        if (entry.type !== 'iife' || !existsSync(entry.absPath)) continue;
        const code = await bundleIifeClientJS(entry.absPath, { minify: true });
        this.emitFile({
          type: 'asset',
          fileName: `_hs/js/${entry.esmName}.js`,
          source: code,
        });
      }
    },

    generateBundle(_outputOptions, bundle) {
      for (const fileName of Object.keys(bundle)) {
        const base = basename(fileName.split('?')[0], '.js');
        if (!base.startsWith('client-')) continue;
        registerImport(base, `/${fileName}`);
      }
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleClientJSDevRequestFromReq(req, res, server, next);
      });
    },
    handleHotUpdate({ file, server }) {
      const changed = file.replace(/\\/g, '/');
      const isClient = getClientJSEntries().some(
        (entry) => entry.absPath.replace(/\\/g, '/') === changed
      );
      if (isClient) {
        server.ws.send({ type: 'full-reload' });
      }
    },
  };
}

export function syncClientJSManifestEntries(entries: ClientJSEntry[]): void {
  for (const entry of entries) {
    registerImport(entry.esmName, entry.publicPath);
  }
}

export async function buildRegisteredClientJS(
  root: string,
  buildOutDir: string
): Promise<Record<string, string>> {
  const entries = getClientJSEntries().filter((entry) => existsSync(entry.absPath));
  if (entries.length === 0) {
    return {};
  }

  const outDir = isAbsolute(buildOutDir) ? buildOutDir : join(root, buildOutDir);
  const iifeEntries = entries.filter((entry) => entry.type === 'iife');
  const esmEntries = entries.filter((entry) => entry.type === 'module');
  const imports: Record<string, string> = {};

  for (const entry of iifeEntries) {
    const code = await bundleIifeClientJS(entry.absPath, { minify: true });
    const outFile = join(outDir, '_hs/js', `${entry.esmName}.js`);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, code);
    imports[entry.esmName] = `/_hs/js/${entry.esmName}.js`;
  }

  if (esmEntries.length > 0) {
    const { build } = await import('vite');
    const input = Object.fromEntries(esmEntries.map((entry) => [entry.esmName, entry.absPath]));

    await build({
      root,
      configFile: false,
      logLevel: 'warn',
      envPrefix: ['APP_PUBLIC_', 'VITE_'],
      build: {
        outDir,
        emptyOutDir: false,
        minify: true,
        lib: {
          entry: input,
          formats: ['es'],
          fileName: (_format, entryName) => `_hs/js/${entryName}.js`,
        },
        rollupOptions: {
          output: {
            exports: 'named',
          },
        },
      },
      resolve: {
        alias: resolveModuleAliases(root),
      },
    });

    for (const entry of esmEntries) {
      imports[entry.esmName] = `/_hs/js/${entry.esmName}.js`;
    }
  }

  return imports;
}

export function isClientJSRequest(url: string): boolean {
  return url.startsWith(`${JS_PUBLIC_PATH}/client-`) && url.endsWith('.js');
}

export async function handleClientJSDevRequestFromReq(
  req: IncomingMessage,
  res: ServerResponse,
  viteServer: ViteDevServer,
  next: () => void
): Promise<void> {
  const url = req.url?.split('?')[0] ?? '/';
  const source = resolveClientJSSource(url);
  if (!source) {
    next();
    return;
  }

  try {
    const entry = getClientJSEntryByEsmName(basename(url, '.js'));
    const code =
      entry?.type === 'iife'
        ? await bundleIifeClientJS(source)
        : (await viteServer.transformRequest(toViteTransformUrl(source, viteServer.config.root)))
            ?.code;
    if (!code) {
      next();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.end(code);
  } catch (err) {
    viteServer.ssrFixStacktrace(err as Error);
    next(err as Error);
  }
}
