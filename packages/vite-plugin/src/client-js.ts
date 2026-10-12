import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
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
import { assetHash } from '@hyperspan/framework/utils';
import { resolveModuleAliases } from './tsconfig-aliases';

/**
 * Client scripts already emitted by the main Vite client build, keyed by `esmName`.
 * Route discovery runs after that build and must not rebuild them under a second
 * content hash, which would leave two files and an ambiguous manifest.
 */
const BUILT_CLIENT_JS = new Map<string, string>();

export function getBuiltClientJS(): Record<string, string> {
  return Object.fromEntries(BUILT_CLIENT_JS);
}

function isBuiltClientJS(esmName: string): boolean {
  return BUILT_CLIENT_JS.has(esmName);
}

/** Point every identity for one file at the single file that was emitted for it. */
function setBuiltClientUrl(esmNames: string[], publicPath: string): void {
  for (const esmName of esmNames) {
    BUILT_CLIENT_JS.set(esmName, publicPath);
  }
}

/** Public URL for a bundled client file. */
export function publicJsUrl(fileName: string): string {
  return `/${fileName.replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

/**
 * Identity of a built client script, taken from the name it was emitted under.
 * Never parsed out of the filename: filenames are content-addressed, so a
 * `client-<hash>` filename holds a hash of the bundle, not of the identity.
 */
export function clientImportKeyFromBundleEntry(chunk: { name?: string }): string | null {
  return chunk.name?.startsWith('client-') ? chunk.name.replace(/\.js$/, '') : null;
}

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

  // Dev serves each identity under its own name; built files are content-addressed
  // and served as static assets, so only a registered identity resolves here.
  const base = fileName.slice(0, -3);
  return getClientJSEntryByEsmName(base) ? base : null;
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

/** One resolved file, plus every identity registered for it. */
export type ClientJSFileGroup = {
  absPath: string;
  /** Identity the file is built under. */
  canonical: string;
  /** Every identity that resolves to this file, including the canonical one. */
  esmNames: string[];
};

/**
 * Client entries grouped by resolved file. One file can carry several identities —
 * `buildClientJS('app/client/x.ts')` and `buildClientJS('~/app/client/x.ts')` are two
 * specifiers for one file — and each must appear in the manifest, but the file itself
 * has to be bundled and emitted exactly once. Sorted so the canonical identity does
 * not move between builds.
 */
export function clientJSFileGroups(type?: ClientJSEntry['type']): ClientJSFileGroup[] {
  const byFile = new Map<string, string[]>();

  for (const entry of getClientJSEntries()) {
    if (type && entry.type !== type) continue;
    const absPath = existingClientFile(entry);
    if (!absPath) continue;
    const esmNames = byFile.get(absPath);
    if (esmNames) {
      esmNames.push(entry.esmName);
    } else {
      byFile.set(absPath, [entry.esmName]);
    }
  }

  return [...byFile.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([absPath, esmNames]) => {
      const sorted = [...esmNames].sort();
      return { absPath, canonical: sorted[0], esmNames: sorted };
    });
}

/** Rollup input for ESM `buildClientJS` entries (IIFE clients are emitted as assets). */
export function clientJSRollupInput(): Record<string, string> {
  return Object.fromEntries(clientJSFileGroups('module').map((g) => [g.canonical, g.absPath]));
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
 * Content-addressed output name. Identical bundles collapse to a single file, and a
 * rebuild of unchanged code reuses the name. The identity lives in the manifest, not
 * in the filename, so one file can serve several identities.
 */
function hashedClientFileName(code: string): string {
  return `_hs/js/client-${assetHash(code)}.js`;
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
  /** Emitted chunk ref by identity group, resolved to a filename in generateBundle. */
  const emitted = new Map<string, { ref: string; esmNames: string[] }>();

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
      // Route discovery starts a nested dev server, whose buildStart must not
      // discard what the production client build already emitted.
      if (command !== 'build') return;
      emitted.clear();
      BUILT_CLIENT_JS.clear();

      for (const group of clientJSFileGroups('module')) {
        const ref = this.emitFile({
          type: 'chunk',
          id: group.absPath,
          name: group.canonical,
        });
        emitted.set(group.canonical, { ref, esmNames: group.esmNames });
      }

      const emittedFiles = new Set<string>();
      for (const group of clientJSFileGroups('iife')) {
        const code = await bundleIifeClientJS(group.absPath, { minify: true });
        // Explicit fileName: `[hash]` placeholders are not applied consistently to
        // emitted assets, which produced extensionless files.
        const fileName = hashedClientFileName(code);
        // Same name means same content, so a second emit would be a duplicate file.
        if (!emittedFiles.has(fileName)) {
          emittedFiles.add(fileName);
          this.emitFile({ type: 'asset', fileName, name: group.canonical, source: code });
        }
        setBuiltClientUrl(group.esmNames, publicJsUrl(fileName));
      }
    },

    generateBundle() {
      for (const [, { ref, esmNames }] of emitted) {
        setBuiltClientUrl(esmNames, publicJsUrl(this.getFileName(ref)));
      }
      for (const [esmName, publicPath] of BUILT_CLIENT_JS) {
        registerImport(esmName, publicPath);
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

/**
 * Build client scripts registered after the main Vite client build (route discovery).
 * Entries the main build already emitted are reused, not rebuilt.
 */
export async function buildRegisteredClientJS(
  root: string,
  buildOutDir: string
): Promise<Record<string, string>> {
  const pending = (type: ClientJSEntry['type']) =>
    clientJSFileGroups(type).filter((group) => !group.esmNames.every(isBuiltClientJS));

  const iifeGroups = pending('iife');
  const esmGroups = pending('module');
  if (iifeGroups.length === 0 && esmGroups.length === 0) {
    return getBuiltClientJS();
  }

  const outDir = isAbsolute(buildOutDir) ? buildOutDir : join(root, buildOutDir);
  const imports: Record<string, string> = {};

  for (const group of iifeGroups) {
    const publicPath = await writeHashedIifeClientJS(group.absPath, outDir);
    for (const esmName of group.esmNames) {
      imports[esmName] = publicPath;
    }
  }

  if (esmGroups.length > 0) {
    const { build } = await import('vite');
    const input = Object.fromEntries(esmGroups.map((group) => [group.canonical, group.absPath]));

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
            entryFileNames: '_hs/js/client-[hash].js',
            exports: 'named',
          },
        },
      },
      resolve: {
        alias: resolveModuleAliases(root),
      },
    });

    const byCanonical = new Map(esmGroups.map((group) => [group.canonical, group.esmNames]));
    const results = Array.isArray(buildResult) ? buildResult : [buildResult];
    for (const result of results) {
      if (!result || !('output' in result)) continue;
      for (const item of result.output) {
        if (item.type !== 'chunk') continue;
        for (const esmName of byCanonical.get(item.name) ?? []) {
          imports[esmName] = publicJsUrl(item.fileName);
        }
      }
    }

    for (const group of esmGroups) {
      for (const esmName of group.esmNames) {
        imports[esmName] ??= `/_hs/js/${esmName}.js`;
      }
    }
  }

  return { ...getBuiltClientJS(), ...imports };
}

async function writeHashedIifeClientJS(absPath: string, outDir: string): Promise<string> {
  const code = await bundleIifeClientJS(absPath, { minify: true });
  const fileName = hashedClientFileName(code);
  const outFile = join(outDir, fileName);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, code);
  return publicJsUrl(fileName);
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
