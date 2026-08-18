import { mkdirSync, existsSync } from 'node:fs';
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

function existingClientFile(entry: ClientJSEntry): string | null {
  return existsSync(entry.absPath) ? entry.absPath : null;
}

function clientEsmNameFromPublicUrl(id: string): string | null {
  const publicPath = publicClientJSPath(id);
  if (!publicPath) {
    return null;
  }

  const fileName = basename(publicPath);
  if (!fileName.startsWith('client-') || !fileName.endsWith('.js')) {
    return null;
  }

  const base = fileName.slice(0, -3);
  if (getClientJSEntryByEsmName(base)) {
    return base;
  }

  const withViteHash = base.match(/^(client-[0-9a-f]{16})(?:-[a-zA-Z0-9]+)?$/);
  return withViteHash?.[1] ?? null;
}

export function resolveClientJSSource(id: string): string | null {
  const esmName = clientEsmNameFromPublicUrl(id);
  if (!esmName) {
    return null;
  }

  const entry = getClientJSEntryByEsmName(esmName);
  if (!entry) {
    return null;
  }
  return existingClientFile(entry);
}

/** Rollup input for ESM `buildClientJS` entries (IIFE clients are emitted as assets). */
export function clientJSRollupInput(): Record<string, string> {
  return Object.fromEntries(
    getClientJSEntries()
      .filter((entry) => entry.type === 'module')
      .map((entry) => [entry.esmName, existingClientFile(entry)] as const)
      .filter((item): item is [string, string] => Boolean(item[1]))
  );
}

/**
 * Bundle a client script for dev serving (works for sources outside Vite root, e.g. linked packages).
 */
export async function bundleClientJSDev(
  absPath: string,
  type: ClientJSEntry['type'],
  options: { minify?: boolean } = {}
): Promise<string> {
  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    absWorkingDir: dirname(absPath),
    entryPoints: [absPath],
    bundle: true,
    format: type === 'iife' ? 'iife' : 'esm',
    platform: 'browser',
    write: false,
    minify: options.minify ?? false,
    logLevel: 'silent',
  });
  const code = result.outputFiles?.[0]?.text;
  if (!code) {
    throw new Error(`[Hyperspan] Failed to bundle client script: ${absPath}`);
  }
  return code;
}

/**
 * Bundle a `buildClientJS(..., { type: 'iife' })` entry as a classic script (no import/export).
 */
export async function bundleIifeClientJS(
  absPath: string,
  options: { minify?: boolean } = {}
): Promise<string> {
  return bundleClientJSDev(absPath, 'iife', options);
}

export function clientJSPlugin(): Plugin {
  let command: 'build' | 'serve' = 'serve';
  const emitted = new Map<string, string>();

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
      emitted.clear();
      if (command !== 'build') return;

      for (const entry of getClientJSEntries()) {
        const absPath = existingClientFile(entry);
        if (entry.type === 'iife' || !absPath) continue;
        const ref = this.emitFile({
          type: 'chunk',
          id: absPath,
          name: entry.esmName,
        });
        emitted.set(entry.esmName, ref);
      }

      for (const entry of getClientJSEntries()) {
        const absPath = existingClientFile(entry);
        if (entry.type !== 'iife' || !absPath) continue;
        const code = await bundleIifeClientJS(absPath, { minify: true });
        const ref = this.emitFile({
          type: 'asset',
          name: entry.esmName,
          originalFileName: `${entry.esmName}.js`,
          source: code,
        });
        emitted.set(entry.esmName, ref);
      }
    },

    generateBundle() {
      for (const [esmName, ref] of emitted) {
        registerImport(esmName, `/${this.getFileName(ref)}`);
      }
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleClientJSDevRequestFromReq(req, res, server, next);
      });
    },
    handleHotUpdate({ file, server }) {
      const changed = file.replace(/\\/g, '/');
      const isClient = getClientJSEntries().some((entry) => {
        return entry.absPath.replace(/\\/g, '/') === changed;
      });
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
  const entries = getClientJSEntries()
    .map((entry) => {
      const absPath = existingClientFile(entry);
      return absPath ? { ...entry, absPath } : null;
    })
    .filter((entry): entry is ClientJSEntry => entry !== null);
  if (entries.length === 0) {
    return {};
  }

  const outDir = isAbsolute(buildOutDir) ? buildOutDir : join(root, buildOutDir);
  const iifeEntries = entries.filter((entry) => entry.type === 'iife');
  const esmEntries = entries.filter((entry) => entry.type === 'module');
  const imports: Record<string, string> = {};

  for (const entry of iifeEntries) {
    const publicPath = await writeHashedIifeClientJS(entry.absPath, entry.esmName, outDir);
    imports[entry.esmName] = publicPath;
  }

  if (esmEntries.length > 0) {
    const { build } = await import('vite');
    const input = Object.fromEntries(esmEntries.map((entry) => [entry.esmName, entry.absPath]));

    const buildResult = await build({
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
        },
        rolldownOptions: {
          output: {
            entryFileNames: '_hs/js/[name]-[hash].js',
            exports: 'named',
          },
        },
      },
      resolve: {
        alias: resolveModuleAliases(root),
      },
    });

    const results = Array.isArray(buildResult) ? buildResult : [buildResult];
    for (const result of results) {
      if (!result || !('output' in result)) continue;
      for (const item of result.output) {
        if (item.type === 'chunk' && item.name.startsWith('client-')) {
          imports[item.name] = `/${item.fileName}`.replace(/\\/g, '/');
        }
      }
    }

    for (const entry of esmEntries) {
      imports[entry.esmName] ??= `/_hs/js/${entry.esmName}.js`;
    }
  }

  return imports;
}

async function writeHashedIifeClientJS(
  absPath: string,
  esmName: string,
  outDir: string
): Promise<string> {
  const esbuild = await import('esbuild');
  const jsDir = join(outDir, '_hs/js');
  mkdirSync(jsDir, { recursive: true });
  const result = await esbuild.build({
    absWorkingDir: dirname(absPath),
    entryPoints: { [esmName]: absPath },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: true,
    minify: true,
    outdir: jsDir,
    entryNames: '[name]-[hash]',
    logLevel: 'silent',
    metafile: true,
  });
  const output = Object.keys(result.metafile?.outputs ?? {}).find((filePath) =>
    basename(filePath).startsWith(`${esmName}-`)
  );
  if (!output) {
    throw new Error(`[Hyperspan] Failed to emit hashed IIFE client script: ${absPath}`);
  }
  return `/_hs/js/${basename(output)}`;
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
    const entry = getClientJSEntryByEsmName(
      clientEsmNameFromPublicUrl(url) ?? basename(url, '.js')
    );
    const code = await bundleClientJSDev(source, entry?.type ?? 'module');
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
