import { describe, test, expect, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Plugin } from 'vite';
import { getAssetManifest, setAssetManifest } from '@hyperspan/framework';
import {
  registerIslandPlugin,
  isIslandPluginLoaded,
  getIslandFramework,
  isIslandModule,
  assertIslandPluginLoaded,
  resetIslandPluginsForTests,
  resolveRegisteredIslandVitePlugins,
  registerClientChunkAliases,
  rewriteIslandImportQueries,
  isSsrTransform,
  islandClientPublicUrl,
  registerIslandClientUrl,
  discoverIslandClientEntries,
  externalClientIslandRuntime,
  isRuntimeSpecifier,
  registerRuntimeSpecifier,
  viteFsUrl,
  buildIslandHtml,
  getIslandPluginRegistration,
} from './islands';

function testPreactRegistration() {
  return {
    framework: 'preact',
    ext: '.tsx',
    specifiers: ['preact', 'preact/hooks'] as const,
    vitePlugin: () => ({ name: 'test-preact' }) as Plugin,
  };
}

describe('islands registry', () => {
  beforeEach(() => {
    resetIslandPluginsForTests();
    setAssetManifest({ imports: {}, css: {}, clients: {} });
  });

  test('registerIslandPlugin tracks loaded frameworks', () => {
    expect(isIslandPluginLoaded('preact')).toBe(false);
    registerIslandPlugin(testPreactRegistration());
    expect(isIslandPluginLoaded('preact')).toBe(true);
  });

  test('resolveRegisteredIslandVitePlugins returns registered vite plugins', () => {
    registerIslandPlugin(testPreactRegistration());
    expect(resolveRegisteredIslandVitePlugins()).toEqual([{ name: 'test-preact' }]);
  });

  test('getIslandPluginRegistration returns plugin metadata', () => {
    registerIslandPlugin(testPreactRegistration());
    expect(getIslandPluginRegistration('preact')).toMatchObject({
      framework: 'preact',
      ext: '.tsx',
      specifiers: ['preact', 'preact/hooks'],
    });
  });

  test('getIslandFramework reads import attributes', () => {
    expect(getIslandFramework('./counter.tsx', { island: 'preact' })).toBe('preact');
  });

  test('getIslandFramework reads query string', () => {
    expect(getIslandFramework('./counter.tsx?island=svelte')).toBe('svelte');
  });

  test('isIslandModule matches framework and extension', () => {
    expect(isIslandModule('/app/widgets/counter.tsx?island=preact', 'preact', '.tsx')).toBe(true);
    expect(isIslandModule('/app/widgets/counter.tsx', 'preact', '.tsx')).toBe(false);
    expect(isIslandModule('/app/widgets/counter.tsx?island=svelte', 'preact', '.tsx')).toBe(false);
  });

  test('externalClientIslandRuntime leaves SSR and non-island imports alone', () => {
    const isPreact = (id: string) => isRuntimeSpecifier(id, ['preact']);
    expect(
      externalClientIslandRuntime(
        'preact',
        '/app/widgets/counter.tsx?island=preact',
        { ssr: true },
        'preact',
        '.tsx',
        isPreact
      )
    ).toBeUndefined();
    expect(
      externalClientIslandRuntime(
        'preact',
        '/app/routes/index.ts',
        undefined,
        'preact',
        '.tsx',
        isPreact
      )
    ).toBeUndefined();
  });

  test('externalClientIslandRuntime marks client island runtimes as external', () => {
    expect(
      externalClientIslandRuntime(
        'preact/hooks',
        '/app/widgets/counter.tsx?island=preact',
        { ssr: false },
        'preact',
        '.tsx',
        (id) => isRuntimeSpecifier(id, ['preact'])
      )
    ).toEqual({ id: 'preact/hooks', external: true });
  });

  test('assertIslandPluginLoaded throws with helpful message', () => {
    expect(() => assertIslandPluginLoaded('preact', './x.tsx')).toThrow(/preact island plugin/);
  });

  test('island plugin registry is shared on globalThis so jiti and Vite see the same plugins', () => {
    registerIslandPlugin(testPreactRegistration());
    const key = Symbol.for('@hyperspan/island-plugins');
    const registry = (globalThis as typeof globalThis & { [key]?: Map<string, unknown> })[key];
    expect(registry?.has('preact')).toBe(true);
  });

  test('rewriteIslandImportQueries appends ?island= so Vite SSR can resolve the import', () => {
    const input = `import Counter from '~/app/components/client-counter.tsx' with { island: 'preact' };`;
    expect(rewriteIslandImportQueries(input)).toContain(
      `from '~/app/components/client-counter.tsx?island=preact' with { island: 'preact' }`
    );
  });

  test('discoverIslandClientEntries finds with { island } imports', () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-islands-'));
    mkdirSync(join(root, 'app/components'), { recursive: true });
    mkdirSync(join(root, 'app/routes'), { recursive: true });
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '~/*': ['./*'] } } })
    );
    writeFileSync(
      join(root, 'app/components/counter.tsx'),
      'export default function C() { return null; }\n'
    );
    writeFileSync(
      join(root, 'app/routes/index.ts'),
      `import C from '~/app/components/counter.tsx' with { island: 'preact' };\nexport default C;\n`
    );

    const entries = discoverIslandClientEntries(root);
    expect(Object.keys(entries).some((name) => name.startsWith('island-'))).toBe(true);
    expect(Object.values(entries).some((id) => id.endsWith('counter.tsx?island=preact'))).toBe(
      true
    );
  });

  test('rewriteIslandImportQueries leaves existing island queries alone', () => {
    const input = `import Counter from './x.tsx?island=preact' with { island: 'preact' };`;
    expect(rewriteIslandImportQueries(input)).toBeNull();
  });

  test('isSsrTransform prefers the explicit ssr flag', () => {
    expect(isSsrTransform({ environment: { name: 'client' } }, { ssr: true })).toBe(true);
    expect(isSsrTransform({ environment: { name: 'ssr' } }, { ssr: false })).toBe(false);
    expect(isSsrTransform({ environment: { name: 'ssr' } })).toBe(true);
  });

  test('islandClientPublicUrl uses Vite module URLs in development', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    expect(islandClientPublicUrl('/app/components/counter.tsx', 'preact', '/app')).toBe(
      '/components/counter.tsx?island=preact'
    );
    process.env.NODE_ENV = prev;
  });

  test('registerIslandClientUrl writes the island import map entry', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const esmName = registerIslandClientUrl('/app/components/counter.tsx', 'preact', '/app');
    expect(esmName).toMatch(/^island-/);
    expect(getAssetManifest().imports[esmName]).toBe('/components/counter.tsx?island=preact');
    process.env.NODE_ENV = prev;
  });

  test('dev runtime specifiers share one client file instead of /@id/subpaths', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const devUrl = viteFsUrl('/pkg/preact-client.ts');
    registerRuntimeSpecifier('preact', '/islands/preact-client.js', { devUrl });
    registerRuntimeSpecifier('preact/hooks', '/islands/preact-client.js', { devUrl });
    const imports = getAssetManifest().imports;
    expect(imports.preact).toBe('/@fs/pkg/preact-client.ts');
    expect(imports['preact/hooks']).toBe('/@fs/pkg/preact-client.ts');
    expect(imports['preact/hooks']).not.toContain('/@id/');
    process.env.NODE_ENV = prev;
  });

  test('registerClientChunkAliases maps a client chunk onto import specifiers', () => {
    registerClientChunkAliases(
      { 'islands/preact-client.js': { type: 'chunk' } },
      (fileName) => fileName.endsWith('preact-client.js'),
      ['preact', 'preact/hooks']
    );
    const imports = getAssetManifest().imports;
    expect(imports['preact-client']).toBe('/islands/preact-client.js');
    expect(imports.preact).toBe('/islands/preact-client.js');
    expect(imports['preact/hooks']).toBe('/islands/preact-client.js');
  });

  test('buildIslandHtml wraps SSR content and client script', () => {
    const result = buildIslandHtml('abc', 'Counter', 'island-abc', 'console.log(1)', '<p>hi</p>');
    expect(result).toContain('id="abc"');
    expect(result).toContain('<p>hi</p>');
    expect(result).toContain('import Counter from "island-abc"');
    expect(result).toContain('console.log(1)');
  });

  test('buildIslandHtml supports named exports and lazy loading', () => {
    const result = buildIslandHtml('abc', 'Counter', 'island-abc', '', '<p>hi</p>', {
      exportKind: 'named',
      loading: 'lazy',
    });
    expect(result).toContain('import { Counter } from "island-abc"');
    expect(result).toContain('data-loading="lazy"');
  });
});
