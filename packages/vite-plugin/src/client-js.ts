import { existsSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
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

export function clientJSPlugin(): Plugin {
  return {
    name: 'hyperspan-client-js',
    enforce: 'pre',

    resolveId(id) {
      if (!id.startsWith(`${JS_PUBLIC_PATH}/client-`) || !id.endsWith('.js')) {
        return null;
      }
      const esmName = basename(id, '.js');
      const entry = getClientJSEntryByEsmName(esmName);
      if (!entry || !existsSync(entry.absPath)) {
        return null;
      }
      return `\0hyperspan-client-js:${entry.absPath}`;
    },

    load(id) {
      if (!id.startsWith('\0hyperspan-client-js:')) {
        return null;
      }
      const absPath = id.slice('\0hyperspan-client-js:'.length);
      return `export * from ${JSON.stringify(absPath)};`;
    },

    buildStart() {
      for (const entry of getClientJSEntries()) {
        if (!existsSync(entry.absPath)) continue;
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
    },

    generateBundle(_outputOptions, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue;
        if (!fileName.includes('client-')) continue;
        const base = basename(fileName, '.js');
        if (!base.startsWith('client-')) continue;
        registerImport(base, `/${fileName}`);
      }
    },
  };
}

export async function discoverClientJSForRoutes(
  server: {
    _routes: Array<{ _path: () => string; fetch: (request: Request) => Promise<Response> }>;
  },
  baseUrl: string
): Promise<void> {
  for (const route of server._routes) {
    const path = route._path();
    const url = path === '/' ? `${baseUrl}/` : `${baseUrl}${path}`;
    try {
      const response = await route.fetch(new Request(url));
      if (response.body) {
        await response.body.cancel();
      }
    } catch (err) {
      console.warn(`[Hyperspan] Client JS discovery skipped for ${url}:`, err);
    }
  }
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
  const entries = getClientJSEntries();
  if (entries.length === 0) {
    return {};
  }

  const { build } = await import('vite');
  const outDir = isAbsolute(buildOutDir) ? buildOutDir : join(root, buildOutDir);
  const input = Object.fromEntries(entries.map((entry) => [entry.esmName, entry.absPath]));

  await build({
    root,
    configFile: false,
    logLevel: 'warn',
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

  const imports: Record<string, string> = {};
  for (const entry of entries) {
    imports[entry.esmName] = `/_hs/js/${entry.esmName}.js`;
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
  if (!isClientJSRequest(url)) {
    next();
    return;
  }

  const esmName = basename(url, '.js');
  const entry = getClientJSEntryByEsmName(esmName);
  if (!entry || !existsSync(entry.absPath)) {
    next();
    return;
  }

  try {
    const result = await viteServer.transformRequest(entry.absPath);
    if (!result?.code) {
      next();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/javascript');
    res.end(result.code);
  } catch (err) {
    viteServer.ssrFixStacktrace(err as Error);
    next(err as Error);
  }
}
