import type { Plugin } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetHash } from '@hyperspan/framework/utils';
import { renderIsland } from '@hyperspan/framework';
import type { Hyperspan as HS } from '@hyperspan/framework';
import { html } from '@hyperspan/framework/html';
import { h } from 'preact';
import { render as preactRenderToString } from 'preact-render-to-string';

export { render as renderToString } from 'preact-render-to-string';
import {
  registerIslandPlugin,
  isIslandModule,
  islandPluginResolveId,
  splitIslandId,
  registerClientChunkAliases,
  registerIslandClientUrl,
  registerRuntimeSpecifier,
  isSsrTransform,
  externalClientIslandRuntime,
  isRuntimeSpecifier,
  viteFsUrl,
  buildIslandHtmlSource,
  type IslandExportKind,
} from '@hyperspan/vite-plugin/islands';
import {
  preactSingletonAliases,
  resolvePackageDir,
  resolvePreactSpecifier,
} from './resolve-package';
import debug from 'debug';

const log = debug('hyperspan:plugin-preact');

const PREACT_ISLAND = {
  framework: 'preact',
  ext: '.tsx',
  specifiers: [
    'preact',
    'preact/hooks',
    'preact/jsx-runtime',
    'preact/jsx-dev-runtime',
    'preact/compat',
    'react',
    'react-dom',
  ] as const,
  runtimePrefixes: ['preact', 'react', 'react-dom', 'preact-render-to-string'] as const,
} as const;

export type { IslandExportKind };

export function renderPreactSSR(Component: unknown, props: Record<string, unknown> = {}): string {
  return preactRenderToString(h(Component as Parameters<typeof h>[0], props));
}

type DiscoveredExport = { name: string; kind: IslandExportKind };

function extractDefaultExportName(code: string): string | null {
  const patterns = [
    /export\{([^\s]+) as default\}/,
    /export default function\s+([^\s(]+)/,
    /export default function\s*\(/,
    /export default const\s+([^\s=]+)/,
    /export default class\s+([^\s{]+)/,
  ];
  for (const re of patterns) {
    const m = code.match(re);
    if (m?.[1]) return m[1];
  }
  if (/export default function/.test(code)) return 'DefaultComponent';
  const anyMatch = code.match(/export default\s+([A-Za-z_$][\w$]*)/);
  return anyMatch?.[1] ?? null;
}

function discoverPreactExports(code: string): DiscoveredExport[] {
  const exports: DiscoveredExport[] = [];
  const seen = new Set<string>();

  const defaultName = extractDefaultExportName(code);
  if (defaultName) {
    exports.push({ name: defaultName, kind: 'default' });
    seen.add(defaultName);
  }

  for (const re of [
    /export\s+function\s+([A-Za-z_$][\w$]*)/g,
    /export\s+const\s+([A-Za-z_$][\w$]*)/g,
    /export\s+class\s+([A-Za-z_$][\w$]*)/g,
  ]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(code)) !== null) {
      if (!seen.has(match[1])) {
        exports.push({ name: match[1], kind: 'named' });
        seen.add(match[1]);
      }
    }
  }

  const exportBlock = /export\s*\{([^}]+)\}/g;
  let block: RegExpExecArray | null;
  while ((block = exportBlock.exec(code)) !== null) {
    for (const part of block[1].split(',')) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith('type ')) continue;
      const asMatch = trimmed.match(/^(?:([\w$]+)\s+as\s+)?([\w$]+)$/);
      const name = asMatch?.[2] ?? trimmed;
      if (name && name !== 'default' && !seen.has(name)) {
        exports.push({ name, kind: 'named' });
        seen.add(name);
      }
    }
  }

  return exports;
}

function buildIslandAttachment(
  exportInfo: DiscoveredExport,
  cleanId: string,
  esmName: string
): string {
  const { name: componentName, kind } = exportInfo;
  const jsId = assetHash(`${cleanId}:${componentName}`);
  const exportKind = kind;

  return `
${componentName}.__HS_ISLAND = {
  id: "${jsId}",
  render: (props, options = {}) => {
    const __hs_exportKind = ${JSON.stringify(exportKind)};
    if (options.ssr === false) {
      const jsContent = \`import { h as __hs_h, render as __hs_render } from 'preact';__hs_render(__hs_h(${componentName}, \${JSON.stringify(props)}), document.getElementById("${jsId}"));\`;
      return __hs_renderIsland_${componentName}(jsContent, '', options);
    }
    const ssrContent = __hs_renderToString(__hs_h(${componentName}, props));
    const jsContent = \`import { h as __hs_h, hydrate as __hs_hydrate } from 'preact';__hs_hydrate(__hs_h(${componentName}, \${JSON.stringify(props)}), document.getElementById("${jsId}"));\`;
    return __hs_renderIsland_${componentName}(jsContent, ssrContent, options);
  }
};

function __hs_renderIsland_${componentName}(jsContent = '', ssrContent = '', options = {}) {
  return __hs_buildIslandHtml("${jsId}", "${componentName}", "${esmName}", jsContent, ssrContent, { ...options, exportKind: ${JSON.stringify(exportKind)} });
}
`;
}

const PREACT_CLIENT_SPECIFIERS = PREACT_ISLAND.specifiers;

/**
 * Vite plugin for Preact islands.
 */
export function preactIslandPlugin(): Plugin {
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const preactClientPath = resolve(dirname(fileURLToPath(import.meta.url)), './preact-client.ts');
  let root = process.cwd();
  const { framework, ext } = PREACT_ISLAND;
  const resolveIslandId = islandPluginResolveId(framework, ext);

  return {
    name: 'hyperspan-preact',
    enforce: 'pre',

    config(config) {
      const projectRoot = config.root ? String(config.root) : process.cwd();
      const prerender = resolvePackageDir(pluginRoot, 'preact-render-to-string');
      return {
        resolve: {
          dedupe: ['preact', 'preact/hooks', 'preact/jsx-runtime'],
        },
        ssr: {
          noExternal: ['preact', 'preact/hooks', 'preact-render-to-string'],
          resolve: {
            alias: {
              ...preactSingletonAliases(projectRoot, pluginRoot),
              ...(prerender ? { 'preact-render-to-string': prerender } : {}),
            },
          },
        },
        optimizeDeps: {
          include: ['preact', 'preact/hooks', 'preact/jsx-runtime'],
        },
      };
    },

    configResolved(config) {
      root = config.root;
    },

    async resolveId(id, importer, options) {
      const island = await resolveIslandId.call(this, id, importer, options);
      if (island) return island;
      const ssr = Boolean(options?.ssr) || this.environment?.name === 'ssr';
      if (!ssr) {
        const isRuntime = (specifier: string) =>
          isRuntimeSpecifier(specifier, PREACT_ISLAND.runtimePrefixes);
        if (
          (this.environment?.mode === 'dev' || this.meta.watchMode) &&
          importer &&
          isIslandModule(importer, framework, ext) &&
          isRuntime(id)
        ) {
          return preactClientPath;
        }
        return externalClientIslandRuntime(id, importer, { ssr: false }, framework, ext, isRuntime);
      }
      return resolvePreactSpecifier(id, root, pluginRoot);
    },

    configureServer() {
      const productionUrl = '/islands/preact-client.js';
      const devUrl = viteFsUrl(preactClientPath);
      for (const spec of PREACT_CLIENT_SPECIFIERS) {
        registerRuntimeSpecifier(spec, productionUrl, { devUrl });
      }
    },

    generateBundle(_options, bundle) {
      registerClientChunkAliases(
        bundle,
        (fileName) =>
          fileName.includes('islands/preact-client') || fileName.endsWith('preact-client.js'),
        PREACT_CLIENT_SPECIFIERS
      );
    },

    async transform(code, id, options) {
      if (!isIslandModule(id, framework, ext)) return;

      log('transform island', id);
      const cleanId = splitIslandId(id).path;
      const esmName = registerIslandClientUrl(cleanId, framework, root);
      const exports = discoverPreactExports(code);

      if (exports.length === 0) {
        throw new Error(
          `No component exports found in ${cleanId}. Export a default or named Preact component and import with \`with { island: '${framework}' }\`.`
        );
      }

      if (!isSsrTransform(this, options)) {
        const esbuild = await import('esbuild');
        const result = await esbuild.transform(code, {
          loader: 'tsx',
          jsx: 'transform',
          jsxFactory: 'h',
          jsxFragment: 'Fragment',
          sourcefile: cleanId,
        });
        return { code: result.code, map: result.map || null };
      }

      const attachments = exports
        .map((exp) => buildIslandAttachment(exp, cleanId, esmName))
        .join('\n');

      const moduleCode = `// hyperspan:processed
import { h as __hs_h, render as __hs_render, hydrate as __hs_hydrate } from 'preact';
import { render as __hs_renderToString } from 'preact-render-to-string';
${buildIslandHtmlSource}

${code}
${attachments}
`;

      return { code: moduleCode, map: null };
    },

    buildStart() {
      if (this.meta.watchMode) return;
      try {
        this.emitFile({
          type: 'chunk',
          id: preactClientPath,
          fileName: 'islands/preact-client.js',
        });
      } catch {
        // Serve mode — client is resolved via import map / Vite deps instead.
      }
    },
  };
}

/**
 * Hyperspan config plugin — register in hyperspan.config.ts plugins array.
 */
export function preactPlugin(): HS.Plugin {
  registerIslandPlugin({
    framework: PREACT_ISLAND.framework,
    ext: PREACT_ISLAND.ext,
    specifiers: PREACT_ISLAND.specifiers,
    vitePlugin: preactIslandPlugin,
  });
  return () => {
    log('preactPlugin loaded');
  };
}

export function renderPreactIsland(
  Component: Parameters<typeof renderIsland>[0],
  props: Record<string, unknown> = {},
  options: Parameters<typeof renderIsland>[2] = { ssr: true }
) {
  return renderIsland(Component, props, options);
}
