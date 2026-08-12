import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import fg from 'fast-glob';
import type { Plugin, ViteDevServer, ResolvedConfig } from 'vite';
import {
  createServer,
  createFetchHandler,
  setAssetManifest,
  registerRouteModule,
  getAssetManifest,
} from '@hyperspan/framework';
import type { AssetManifest } from '@hyperspan/framework';
import { isValidRoutePath } from '@hyperspan/framework/utils';
import type { Hyperspan as HS } from '@hyperspan/framework';
import { createJiti } from 'jiti';
import {
  assertIslandPluginLoaded,
  getIslandFramework,
  resolveRegisteredIslandVitePlugins,
} from './islands';
import { clientJSPlugin, discoverClientJSForRoutes, buildRegisteredClientJS } from './client-js';
import { writeServerEntry } from './generate-server';

export type HyperspanVitePluginOptions = {
  configFile?: string;
};

const MANIFEST_VIRTUAL_ID = 'virtual:hyperspan-manifest';
const RESOLVED_MANIFEST_VIRTUAL_ID = '\0' + MANIFEST_VIRTUAL_ID;

const FRAMEWORK_CLIENT_DIR = fileURLToPath(
  new URL('../../framework/src/client/_hs', import.meta.url)
);

function loadHyperspanConfigSync(root: string, configFile?: string): void {
  const file = configFile ?? join(root, 'hyperspan.config.ts');
  if (!existsSync(file)) return;
  const jiti = createJiti(root, { interopDefault: true });
  jiti(file);
}

export function hyperspan(options: HyperspanVitePluginOptions = {}): Plugin[] {
  let root = process.cwd();
  let resolvedConfig: ResolvedConfig;
  let viteDevServer: ViteDevServer | null = null;
  let hsConfig: HS.Config;
  let serverInstance: HS.Server | null = null;
  let manifest: AssetManifest = { imports: {}, css: {}, clients: {} };
  let fetchHandler: ((req: Request) => Promise<Response>) | null = null;

  const corePlugin: Plugin = {
    name: 'hyperspan',
    enforce: 'pre',

    config(config) {
      const projectRoot = config.root ? String(config.root) : process.cwd();
      loadHyperspanConfigSync(projectRoot, options.configFile);
      const islandPlugins = resolveRegisteredIslandVitePlugins();
      return {
        appType: 'custom' as const,
        plugins: islandPlugins,
        publicDir: config.publicDir ?? 'public',
        resolve: {
          alias: {
            '~': projectRoot,
            '~/': projectRoot + '/',
          },
        },
        build: {
          manifest: true,
          rollupOptions: {
            input: {
              'hyperspan-streaming': join(FRAMEWORK_CLIENT_DIR, 'hyperspan-streaming.client.ts'),
              'hyperspan-actions': join(FRAMEWORK_CLIENT_DIR, 'hyperspan-actions.client.ts'),
              'hyperspan-scripts': join(FRAMEWORK_CLIENT_DIR, 'hyperspan-scripts.client.ts'),
            },
          },
        },
        ssr: {
          // Bundle Hyperspan packages so CJS deps like `debug` are handled by Vite.
          noExternal: [/^@hyperspan\//],
        },
        optimizeDeps: {
          exclude: ['@hyperspan/framework', '@hyperspan/html', '@hyperspan/vite-plugin'],
        },
      };
    },

    configResolved(config) {
      resolvedConfig = config;
      root = config.root;
    },

    async buildStart() {
      try {
        hsConfig = await loadHyperspanConfig(root, options.configFile);
        if (resolvedConfig.command === 'serve') {
          await rebuildServer();
        }
        // Production build: route/CSS discovery runs in closeBundle via a
        // temporary Vite SSR server (buildStart has no module graph yet).
      } catch (err) {
        console.error('[Hyperspan] Failed to load routes during buildStart:', err);
      }
    },

    resolveId(id, _importer, options) {
      if (id === MANIFEST_VIRTUAL_ID) {
        return RESOLVED_MANIFEST_VIRTUAL_ID;
      }

      const framework = getIslandFramework(id, options?.attributes as Record<string, string>);
      if (framework) {
        assertIslandPluginLoaded(framework, id);
      }
    },

    load(id) {
      if (id === RESOLVED_MANIFEST_VIRTUAL_ID) {
        return `export default ${JSON.stringify(manifest)};`;
      }
    },

    configureServer(server) {
      viteDevServer = server;
      setupDevMiddleware(server);
      rebuildServer().catch((err) => console.error('[Hyperspan] Failed to load routes:', err));
    },

    generateBundle(_outputOptions, bundle) {
      const imports: Record<string, string> = { ...manifest.imports };
      const clients: AssetManifest['clients'] = { ...manifest.clients };

      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue;
        // Vite emits client entries under dist/assets and dist/islands
        const publicPath = `/${fileName}`;

        if (fileName.includes('hyperspan-streaming')) {
          clients.streaming = publicPath;
          imports['hyperspan-streaming'] = publicPath;
        } else if (fileName.includes('hyperspan-actions')) {
          clients.actions = publicPath;
          imports['hyperspan-actions'] = publicPath;
        } else if (fileName.includes('hyperspan-scripts')) {
          clients.scripts = publicPath;
          imports['hyperspan-scripts'] = publicPath;
        } else if (
          fileName.includes('islands/preact-client') ||
          fileName.endsWith('preact-client.js')
        ) {
          imports['preact-client'] = publicPath;
          imports['preact'] = publicPath;
          imports['preact/hooks'] = publicPath;
          imports['preact/jsx-runtime'] = publicPath;
          imports['preact/jsx-dev-runtime'] = publicPath;
          imports['preact/compat'] = publicPath;
          imports['react'] = publicPath;
          imports['react-dom'] = publicPath;
        } else if (
          fileName.includes('islands/island-') ||
          fileName.includes('_hs/js/islands/island-')
        ) {
          const esmName = fileName.split('/').pop()!.replace(/\.js$/, '');
          imports[esmName] = publicPath;
        } else if (
          fileName.includes('islands/svelte-client') ||
          fileName.includes('islands/vue-client')
        ) {
          const esmName = fileName.split('/').pop()!.replace(/\.js$/, '');
          imports[esmName] = publicPath;
        } else if (fileName.includes('_hs/js/client-')) {
          const esmName = fileName.split('/').pop()!.replace(/\.js$/, '');
          imports[esmName] = publicPath;
        }

        // Collect CSS emitted alongside chunks
        if (chunk.type === 'chunk' && 'viteMetadata' in chunk) {
          const importedCss = (chunk as { viteMetadata?: { importedCss?: Set<string> } })
            .viteMetadata?.importedCss;
          if (importedCss) {
            for (const cssFile of importedCss) {
              const cssPath = `/${cssFile}`;
              // Will be associated with routes in closeBundle SSR pass
              manifest.css['*'] = [...new Set([...(manifest.css['*'] ?? []), cssPath])];
            }
          }
        }
      }

      manifest = { ...manifest, imports, clients };
      setAssetManifest(manifest);
      emitManifestFile(root, manifest, resolvedConfig.build.outDir);
    },

    async closeBundle() {
      if (resolvedConfig.command === 'build' && !process.env.HYPERSPAN_SKIP_BUILD_DISCOVERY) {
        try {
          await discoverRoutesForBuild();
        } catch (err) {
          console.error('[Hyperspan] Failed to discover routes/CSS during build:', err);
        }
      }
      emitManifestFile(root, manifest, resolvedConfig.build.outDir);
    },
  };

  /**
   * During `vite build`, spin up a middleware-mode Vite server so we can
   * ssrLoadModule routes (handles CSS/TSX) and record CSS into the manifest.
   */
  async function discoverRoutesForBuild() {
    const { createServer: createViteServer } = await import('vite');
    // Prevent nested Vite instances from re-entering discovery on close.
    process.env.HYPERSPAN_SKIP_BUILD_DISCOVERY = '1';
    // Reuse the app's vite.config (already includes this plugin + islands).
    const ssrVite = await createViteServer({
      configFile: typeof resolvedConfig.configFile === 'string' ? resolvedConfig.configFile : false,
      root,
      server: { middlewareMode: true },
      appType: 'custom',
    });

    try {
      hsConfig = hsConfig ?? (await loadHyperspanConfig(root, options.configFile));
      const tempServer = await createServer(hsConfig);
      tempServer._routes = [];
      await loadRoutes(tempServer, root, hsConfig, ssrVite);

      await discoverClientJSForRoutes(tempServer, 'http://hyperspan-build.local');

      const clientImports = await buildRegisteredClientJS(root, resolvedConfig.build.outDir);
      if (Object.keys(clientImports).length > 0) {
        manifest = {
          ...manifest,
          imports: { ...manifest.imports, ...clientImports },
        };
      }

      const cssByRoute: Record<string, string[]> = { ...(manifest.css ?? {}) };
      for (const route of tempServer._routes) {
        const path = route._path();
        const css = route._config.cssImports ?? [];
        if (css.length) {
          const prodCss = await materializeCssForProduction(ssrVite, css, root, resolvedConfig);
          cssByRoute[path] = prodCss;
        }
      }

      if (manifest.css['*']?.length) {
        for (const route of tempServer._routes) {
          const path = route._path();
          cssByRoute[path] = [...new Set([...(cssByRoute[path] ?? []), ...manifest.css['*']])];
        }
      }

      manifest = { ...manifest, css: cssByRoute };
      setAssetManifest(manifest);
      console.log(
        `[Hyperspan] Discovered ${tempServer._routes.length} routes for production manifest`
      );

      const buildOutDir = isAbsolute(resolvedConfig.build.outDir)
        ? resolvedConfig.build.outDir
        : join(root, resolvedConfig.build.outDir);
      await writeServerEntry({
        root,
        outDir: buildOutDir,
        appDir: hsConfig.appDir ?? './app',
        deployTarget: hsConfig.deployTarget ?? 'node',
        configFile:
          typeof options.configFile === 'string' ? join(root, options.configFile) : undefined,
      });
      console.log('[Hyperspan] Generated production server entry');
    } finally {
      // Give pending dep-scan work a moment so close doesn't race Vite internals.
      await new Promise((r) => setTimeout(r, 50));
      await ssrVite.close().catch(() => undefined);
      delete process.env.HYPERSPAN_SKIP_BUILD_DISCOVERY;
    }
  }

  async function rebuildServer() {
    hsConfig = hsConfig ?? (await loadHyperspanConfig(root, options.configFile));
    serverInstance = await createServer(hsConfig);
    serverInstance._routes = [];
    await loadRoutes(serverInstance, root, hsConfig, viteDevServer);
    fetchHandler = createFetchHandler(serverInstance!, {
      onNotMatched: async (request) => serveStatic(request, root, hsConfig.publicDir),
    });
    updateDevManifest();
    await syncServerEntryForDev();
  }

  async function syncServerEntryForDev() {
    if (!resolvedConfig || resolvedConfig.command !== 'serve') {
      return;
    }

    try {
      const outDir = isAbsolute(resolvedConfig.build.outDir)
        ? resolvedConfig.build.outDir
        : join(root, resolvedConfig.build.outDir || 'dist');
      mkdirSync(outDir, { recursive: true });
      await writeServerEntry({
        root,
        outDir,
        appDir: hsConfig.appDir ?? './app',
        deployTarget: hsConfig.deployTarget ?? 'node',
        configFile:
          typeof options.configFile === 'string' ? join(root, options.configFile) : undefined,
      });
    } catch (err) {
      console.warn('[Hyperspan] Could not sync production server entry:', err);
    }
  }

  function isAppRouteFile(file: string): boolean {
    const appDir = (hsConfig?.appDir ?? './app').replace(/^\.\//, '');
    const normalized = file.replace(/\\/g, '/');
    return normalized.includes(`/${appDir}/routes/`) || normalized.includes(`/${appDir}/actions/`);
  }

  async function onAppRouteFileEvent(file: string) {
    hsConfig = hsConfig ?? (await loadHyperspanConfig(root, options.configFile));
    if (!isAppRouteFile(file)) {
      return;
    }
    await rebuildServer();
  }

  function updateDevManifest() {
    manifest = {
      imports: manifest.imports,
      css: manifest.css,
      clients: {
        streaming: '/_hs/js/hyperspan-streaming.client.js',
        actions: '/_hs/js/hyperspan-actions.client.js',
        scripts: '/_hs/js/hyperspan-scripts.client.js',
      },
    };
    setAssetManifest(manifest);
  }

  function setupDevMiddleware(viteServer: ViteDevServer) {
    viteServer.middlewares.use(async (req, res, next) => {
      const url = req.url ?? '/';

      // Let Vite handle its own modules, HMR, and transformed assets (CSS, etc.)
      if (
        url.startsWith('/@') ||
        url.startsWith('/__vite') ||
        url.startsWith('/node_modules') ||
        url.includes('.tsx') ||
        url.includes('.ts') ||
        url.includes('.js') ||
        url.includes('.mjs') ||
        url.includes('.css') ||
        url.includes('.vue') ||
        url.includes('.svelte') ||
        url.includes('.svg') ||
        url.includes('.png') ||
        url.includes('.jpg') ||
        url.includes('.woff')
      ) {
        return next();
      }

      try {
        if (!fetchHandler) {
          hsConfig = await loadHyperspanConfig(root, options.configFile);
          await rebuildServer();
        }

        const host = req.headers.host ?? 'localhost:5173';
        const body =
          req.method !== 'GET' && req.method !== 'HEAD' ? await readNodeBody(req) : undefined;

        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') headers.set(key, value);
          else if (Array.isArray(value)) headers.set(key, value.join(', '));
        }

        const request = new Request(`http://${host}${url}`, {
          method: req.method,
          headers,
          body,
        });

        const response = await fetchHandler!(request);

        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() === 'transfer-encoding') return;
          res.setHeader(key, value);
        });

        if (response.body) {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        }
        res.end();
      } catch (err) {
        viteServer.ssrFixStacktrace(err as Error);
        next(err);
      }
    });

    for (const event of ['change', 'add', 'unlink'] as const) {
      viteServer.watcher.on(event, (file) => {
        void onAppRouteFileEvent(file);
      });
    }
  }

  return [corePlugin, clientJSPlugin()];
}

async function loadHyperspanConfig(root: string, configFile?: string): Promise<HS.Config> {
  const { createJiti } = await import('jiti');
  const jiti = createJiti(root, { interopDefault: true });
  const file = configFile ?? join(root, 'hyperspan.config.ts');
  return jiti(file) as HS.Config;
}

async function loadRoutes(
  server: HS.Server,
  root: string,
  config: HS.Config,
  viteServer: ViteDevServer | null
): Promise<void> {
  for (const dir of ['routes', 'actions'] as const) {
    const directoryPath = join(root, config.appDir, dir);
    if (!existsSync(directoryPath)) continue;

    const files = await fg('**/*.{ts,tsx,js,jsx}', {
      cwd: directoryPath,
      absolute: true,
      onlyFiles: true,
    });

    for (const filePath of files) {
      const relativeFilePath = filePath.slice(directoryPath.length + 1);
      if (!isValidRoutePath(relativeFilePath)) continue;

      const mod = viteServer ? await viteServer.ssrLoadModule(filePath) : await import(filePath);
      const route = registerRouteModule(
        server,
        relativeFilePath,
        mod,
        viteServer ? undefined : getAssetManifest()
      );
      if (route && viteServer) {
        const cssUrls = collectCssUrls(viteServer, filePath);
        if (cssUrls.length > 0) {
          route._config.cssImports = cssUrls;
        }
      }
    }
  }
}

async function materializeCssForProduction(
  viteServer: ViteDevServer,
  cssUrls: string[],
  projectRoot: string,
  config: ResolvedConfig
): Promise<string[]> {
  const { createHash } = await import('node:crypto');
  const buildOutDir = config.build.outDir || 'dist';
  const outDir = isAbsolute(buildOutDir) ? buildOutDir : join(projectRoot, buildOutDir);
  const assetsDir = join(outDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });

  const result: string[] = [];
  for (const url of cssUrls) {
    try {
      // Resolve to a file on disk when possible
      const mod = [...viteServer.moduleGraph.urlToModuleMap.entries()].find(
        ([u]) => u === url || u.startsWith(url)
      )?.[1];
      const file = mod?.file;
      let cssText = '';
      if (file && existsSync(file)) {
        // Transform through Vite to apply Tailwind etc.
        const transformed = await viteServer.transformRequest(url + '?direct');
        cssText = transformed?.code ?? readFileSync(file, 'utf-8');
      } else {
        const transformed = await viteServer.transformRequest(url + '?direct');
        cssText = transformed?.code ?? '';
      }
      if (!cssText) continue;

      const hash = createHash('sha256').update(cssText).digest('hex').slice(0, 8);
      const base =
        (file || url)
          .split('/')
          .pop()
          ?.replace(/\.css$/, '') || 'style';
      const outName = `${base}-${hash}.css`;
      writeFileSync(join(assetsDir, outName), cssText);
      result.push(`/assets/${outName}`);
    } catch (err) {
      console.warn(`[Hyperspan] Could not materialize CSS ${url}:`, err);
    }
  }
  return result;
}

function collectCssUrls(viteServer: ViteDevServer, filePath: string): string[] {
  const mod =
    viteServer.moduleGraph.getModuleById(filePath) ||
    [...viteServer.moduleGraph.idToModuleMap.values()].find((m) => m.file === filePath);

  if (!mod) return [];

  const css: string[] = [];
  const seen = new Set<string>();

  function walk(module: typeof mod | undefined) {
    if (!module?.id || seen.has(module.id)) return;
    seen.add(module.id);

    const id = module.id.split('?')[0];
    if (id.endsWith('.css') || id.endsWith('.scss') || id.endsWith('.sass')) {
      // Prefer the browser-servable URL Vite already knows
      const url = module.url?.startsWith('/') ? module.url.split('?')[0] : undefined;
      if (url) {
        css.push(url);
      } else if (module.file) {
        const root = viteServer.config.root;
        css.push('/' + module.file.slice(root.length + 1).replace(/\\/g, '/'));
      }
    }

    for (const imported of module.importedModules) {
      walk(imported);
    }
  }

  walk(mod);
  return [...new Set(css)];
}

async function serveStatic(
  request: Request,
  root: string,
  publicDir: string
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname.includes('..')) return undefined;

  const { readFile } = await import('node:fs/promises');
  const filePath = join(root, publicDir, url.pathname);

  try {
    const data = await readFile(filePath);
    const ext = url.pathname.split('.').pop() ?? '';
    const types: Record<string, string> = {
      css: 'text/css',
      js: 'application/javascript',
      png: 'image/png',
      jpg: 'image/jpeg',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
    };
    return new Response(data, {
      headers: { 'Content-Type': types[ext] ?? 'application/octet-stream' },
    });
  } catch {
    return undefined;
  }
}

function emitManifestFile(root: string, manifest: AssetManifest, buildOutDir = 'dist') {
  const outDir = isAbsolute(buildOutDir) ? buildOutDir : join(root, buildOutDir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function readNodeBody(req: import('node:http').IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

export { MANIFEST_VIRTUAL_ID };
export {
  registerIslandPlugin,
  isIslandPluginLoaded,
  getIslandFramework,
  isIslandModule,
  islandPluginResolveId,
  getRegisteredIslandFrameworks,
} from './islands';
export type { IslandFramework } from './islands';
