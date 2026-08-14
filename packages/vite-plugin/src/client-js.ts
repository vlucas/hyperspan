import { existsSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const FRAMEWORK_CLIENT_DIR = fileURLToPath(
  new URL('../../framework/src/client/_hs', import.meta.url)
);

const FRAMEWORK_CLIENT_FILES: Record<string, string> = {
  'hyperspan-streaming.client.js': 'hyperspan-streaming.client.ts',
  'hyperspan-actions.client.js': 'hyperspan-actions.client.ts',
  'hyperspan-scripts.client.js': 'hyperspan-scripts.client.ts',
};

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
  const frameworkFile = FRAMEWORK_CLIENT_FILES[fileName];
  if (frameworkFile) {
    const absPath = join(FRAMEWORK_CLIENT_DIR, frameworkFile);
    return existsSync(absPath) ? absPath : null;
  }

  if (!fileName.startsWith('client-')) {
    return null;
  }

  const entry = getClientJSEntryByEsmName(basename(fileName, '.js'));
  if (!entry || !existsSync(entry.absPath)) {
    return null;
  }
  return entry.absPath;
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
  return {
    name: 'hyperspan-client-js',
    enforce: 'pre',

    resolveId(id) {
      return resolveClientJSSource(id);
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

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleClientJSDevRequestFromReq(req, res, server, next);
      });
    },
    handleHotUpdate({ file, server }) {
      const changed = file.replace(/\\/g, '/');
      const isClientSource = getClientJSEntries().some(
        (entry) => entry.absPath.replace(/\\/g, '/') === changed
      );
      if (isClientSource) {
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
  const source = resolveClientJSSource(url);
  if (!source) {
    next();
    return;
  }

  try {
    const result = await viteServer.transformRequest(
      toViteTransformUrl(source, viteServer.config.root)
    );
    if (!result?.code) {
      next();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.end(result.code);
  } catch (err) {
    viteServer.ssrFixStacktrace(err as Error);
    next(err as Error);
  }
}
