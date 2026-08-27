import {
  createConfig,
  createServer,
  initServerRoutes,
  setAssetManifest,
  registerRouteModule,
} from '@hyperspan/framework';
import { nodeAdapter } from '@hyperspan/adapter-node';
import { isValidRoutePath } from '@hyperspan/framework/utils';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import debug from 'debug';
import {
  createAppJiti,
  resolveAliasedSpecifier,
  resolveModuleAliases,
} from '@hyperspan/vite-plugin/tsconfig-aliases';

import type { Hyperspan as HS } from '@hyperspan/framework';

type startConfig = {
  development?: boolean;
};

const CWD = process.cwd();
const log = debug('hyperspan:server');

let loadersRegistered = false;

/**
 * Register Node resolve hooks for tsconfig `paths` (e.g. `~/`) and CSS stubs.
 * Must run before importing a generated `dist/server.ts` in production.
 */
export function registerAppLoaders(root: string = process.cwd()) {
  if (loadersRegistered) return;
  loadersRegistered = true;
  const aliases = resolveModuleAliases(root);

  registerHooks({
    resolve(specifier, context, nextResolve) {
      // Stub stylesheet imports so Node can evaluate route/layout modules.
      if (
        specifier.endsWith('.css') ||
        specifier.endsWith('.scss') ||
        specifier.endsWith('.sass') ||
        specifier.endsWith('.less')
      ) {
        return {
          shortCircuit: true,
          url: 'data:text/javascript,export default {}',
        };
      }

      const resolved = resolveAliasedSpecifier(specifier, aliases);
      if (resolved) {
        for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js']) {
          const candidate = resolved + ext;
          if (existsSync(candidate)) {
            return { shortCircuit: true, url: pathToFileURL(candidate).href };
          }
        }
      }

      return nextResolve(specifier, context);
    },
  });
}

export async function loadConfig(): Promise<HS.Config> {
  registerAppLoaders();
  const configFile = join(CWD, 'hyperspan.config.ts');
  const jiti = createAppJiti(CWD);
  try {
    const config = createConfig(jiti(configFile) as Partial<HS.Config>);
    config.deployAdapter ??= nodeAdapter();
    return config;
  } catch (error) {
    console.error(`[Hyperspan] Unable to load config file: ${error}`);
    console.error(
      `[Hyperspan] Please create a hyperspan.config.ts file in the root of your project.`
    );
    process.exit(1);
  }
}

/**
 * Create a Hyperspan server instance with all routes and actions added.
 * Used by `hyperspan start` (production Node adapter).
 */
export async function createHyperspanServer(startConfig: startConfig = {}): Promise<HS.Server> {
  registerAppLoaders();

  console.log('[Hyperspan] Loading config...');
  const config = await loadConfig();

  // Load build manifest if present (production)
  const manifestPath = join(CWD, 'dist/manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
    setAssetManifest(manifest);
  }

  // Prefer built assets directory when present
  if (existsSync(join(CWD, 'dist'))) {
    config.publicDir = './dist';
  }

  const server = await createServer(config);

  console.log('[Hyperspan] Adding routes...');
  await initServerRoutes(server, config, async (server) => {
    await addDirectoryAsRoutes(server, 'routes', startConfig);
    console.log('[Hyperspan] Adding actions...');
    await addDirectoryAsRoutes(server, 'actions', startConfig);
  });

  return server;
}

async function scanFiles(directoryPath: string): Promise<string[]> {
  const fg = await import('fast-glob');
  return fg.default('**/*.{ts,tsx,js,jsx}', {
    cwd: directoryPath,
    absolute: true,
    onlyFiles: true,
  });
}

export async function addDirectoryAsRoutes(
  server: HS.Server,
  relativeDirectory: string,
  startConfig: startConfig = {}
) {
  registerAppLoaders();

  const appDir = server._config.appDir || './app';
  const directoryPath = join(CWD, appDir, relativeDirectory);

  if (!existsSync(directoryPath)) {
    return;
  }

  log(`Scanning directory for routes: ${directoryPath}`);
  const files = await scanFiles(directoryPath);
  const routeMap: { route: string; file: string }[] = [];

  const routes: Array<HS.Route> = (
    await Promise.all(
      files.map(async (filePath) => {
        try {
          const relativeFilePath = filePath.split(join(CWD, appDir, relativeDirectory)).pop() || '';
          if (!isValidRoutePath(relativeFilePath)) {
            return null;
          }

          log(`Loading route: ${filePath}`);
          const module = await import(pathToFileURL(filePath).href);

          let productionManifest;
          try {
            const manifestPath = join(CWD, 'dist/manifest.json');
            if (existsSync(manifestPath)) {
              productionManifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
            }
          } catch {
            // manifest optional
          }

          const route = registerRouteModule(server, relativeFilePath, module, productionManifest);
          if (!route) {
            return null;
          }

          const path = route._path();

          routeMap.push({ route: path, file: filePath.replace(CWD, '') });
          return route;
        } catch (error) {
          console.error(`[Hyperspan] Error loading route: ${filePath}`);
          console.error(error);
          process.exit(1);
        }
      })
    )
  ).filter((route) => route !== null);

  if (routeMap.length === 0) {
    console.log(`[Hyperspan] No routes found in ${relativeDirectory}`);
    return;
  }

  if (startConfig.development) {
    console.table(routeMap);
  }
}
