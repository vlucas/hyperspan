/// <reference path="./types.d.ts" />
import type { Plugin } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetHash } from '@hyperspan/framework/utils';
import { JS_ISLAND_PUBLIC_PATH } from '@hyperspan/framework/client/js';
import { renderIsland } from '@hyperspan/framework';
import type { Hyperspan as HS } from '@hyperspan/framework';
import { compile } from 'svelte/compiler';
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
} from '@hyperspan/vite-plugin/islands';
import debug from 'debug';

const log = debug('hyperspan:plugin-svelte');

const SVELTE_ISLAND = {
  framework: 'svelte',
  ext: '.svelte',
  specifiers: [
    'svelte',
    'svelte/store',
    'svelte/motion',
    'svelte/transition',
    'svelte/animate',
    'svelte/easing',
    'svelte/internal',
    'svelte/internal/disclose-version',
    'svelte/internal/client',
  ] as const,
  runtimePrefixes: ['svelte'] as const,
} as const;

export async function renderSvelteSSR(
  Component: unknown,
  props: Record<string, unknown> = {}
): Promise<string> {
  const { render } = await import('svelte/server');
  return render(Component as ConstructorParameters<typeof render>[0], { props }).html;
}

function extractComponentName(ssrCode: string): string | null {
  const patterns = [
    /export\{([^\s]+) as default\}/,
    /export default function\s+([^\s(]+)/,
    /export default\s+([^\s;{]+)/,
  ];
  for (const re of patterns) {
    const m = ssrCode.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function svelteIslandPlugin(): Plugin {
  const svelteClientPath = resolve(dirname(fileURLToPath(import.meta.url)), './svelte-client.ts');
  let root = process.cwd();
  const { framework, ext, specifiers } = SVELTE_ISLAND;
  const resolveIslandId = islandPluginResolveId(framework, ext);

  return {
    name: 'hyperspan-svelte',
    enforce: 'pre',

    configResolved(config) {
      root = config.root;
    },

    resolveId(id, importer, options) {
      const ssr = Boolean(options?.ssr) || this.environment?.name === 'ssr';
      const isRuntime = (specifier: string) =>
        isRuntimeSpecifier(specifier, SVELTE_ISLAND.runtimePrefixes);
      if (
        !ssr &&
        (this.environment?.mode === 'dev' || this.meta.watchMode) &&
        importer &&
        isIslandModule(importer, framework, ext) &&
        isRuntime(id)
      ) {
        return svelteClientPath;
      }
      const external = externalClientIslandRuntime(
        id,
        importer,
        options,
        framework,
        ext,
        isRuntime
      );
      if (external) return external;
      return resolveIslandId.call(this, id, importer, options);
    },

    configureServer() {
      const productionUrl = `${JS_ISLAND_PUBLIC_PATH}/svelte-client.js`;
      const devUrl = viteFsUrl(svelteClientPath);
      for (const spec of specifiers) {
        registerRuntimeSpecifier(spec, productionUrl, { devUrl });
      }
    },

    generateBundle(_options, bundle) {
      registerClientChunkAliases(
        bundle,
        (fileName) => fileName.includes('svelte-client'),
        specifiers
      );
    },

    buildStart() {
      if (this.meta.watchMode) return;
      try {
        this.emitFile({
          type: 'chunk',
          id: svelteClientPath,
          fileName: '_hs/js/islands/svelte-client.js',
        });
      } catch {
        // Serve mode — client is resolved via import map / Vite deps instead.
      }
    },

    async transform(code, id, options) {
      if (!isIslandModule(id, framework, ext)) return;

      log('transform svelte island', id);
      const cleanId = splitIslandId(id).path;
      const jsId = assetHash(cleanId);
      const esmName = registerIslandClientUrl(cleanId, framework, root);
      const ssr = isSsrTransform(this, options);

      const compiled = compile(code, {
        filename: cleanId,
        generate: ssr ? 'server' : 'client',
      });
      const compiledCode = compiled.js.code;
      const componentName = extractComponentName(compiledCode);

      if (!componentName) {
        throw new Error(
          `No default export found in ${cleanId}. Export a default Svelte component and import with \`with { island: '${framework}' }\`.`
        );
      }

      if (!ssr) {
        return { code: compiledCode, map: compiled.js.map ?? null };
      }

      const moduleCode = `// hyperspan:processed
${buildIslandHtmlSource}

${compiledCode}

function __hs_renderIsland(jsContent = '', ssrContent = '', options = {}) {
  return __hs_buildIslandHtml("${jsId}", "${componentName}", "${esmName}", jsContent, ssrContent, options);
}

${componentName}.__HS_ISLAND = {
  id: "${jsId}",
  render: async (props, options = {}) => {
    const { render: __hs_svelte_render } = await import('svelte/server');
    if (options.ssr === false) {
      const jsContent = \`import { mount as __hs_mount } from 'svelte';__hs_mount(${componentName}, { target: document.getElementById("${jsId}"), props: \${JSON.stringify(props)} });\`;
      return __hs_renderIsland(jsContent, '', options);
    }
    const { html: ssrContent } = __hs_svelte_render(${componentName}, { props });
    const jsContent = \`import { hydrate as __hs_hydrate } from 'svelte';__hs_hydrate(${componentName}, { target: document.getElementById("${jsId}"), props: \${JSON.stringify(props)} });\`;
    return __hs_renderIsland(jsContent, ssrContent, options);
  }
};
`;

      return { code: moduleCode, map: null };
    },
  };
}

export function sveltePlugin(): HS.Plugin {
  registerIslandPlugin({
    framework: SVELTE_ISLAND.framework,
    ext: SVELTE_ISLAND.ext,
    specifiers: SVELTE_ISLAND.specifiers,
    vitePlugin: svelteIslandPlugin,
  });
  return () => {
    log('sveltePlugin loaded');
  };
}

export async function renderSvelteIsland(
  Component: Parameters<typeof renderIsland>[0],
  props: Record<string, unknown> = {},
  options: Parameters<typeof renderIsland>[2] = { ssr: true }
) {
  const result = renderIsland(Component, props, options);
  if (result != null && typeof (result as Promise<unknown>).then === 'function') {
    return await result;
  }
  return result;
}
