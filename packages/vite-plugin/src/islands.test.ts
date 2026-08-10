import { describe, test, expect, beforeEach } from 'vitest';
import type { Plugin } from 'vite';
import {
  registerIslandPlugin,
  isIslandPluginLoaded,
  getIslandFramework,
  isIslandModule,
  assertIslandPluginLoaded,
  resetIslandPluginsForTests,
  resolveRegisteredIslandVitePlugins,
} from './islands';

describe('islands registry', () => {
  beforeEach(() => {
    resetIslandPluginsForTests();
  });

  test('registerIslandPlugin tracks loaded frameworks', () => {
    expect(isIslandPluginLoaded('preact')).toBe(false);
    registerIslandPlugin('preact', {
      vitePlugin: () => ({ name: 'test-preact' }) as Plugin,
    });
    expect(isIslandPluginLoaded('preact')).toBe(true);
  });

  test('resolveRegisteredIslandVitePlugins returns registered vite plugins', () => {
    registerIslandPlugin('preact', {
      vitePlugin: () => ({ name: 'test-preact' }) as Plugin,
    });
    expect(resolveRegisteredIslandVitePlugins()).toEqual([{ name: 'test-preact' }]);
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

  test('assertIslandPluginLoaded throws with helpful message', () => {
    expect(() => assertIslandPluginLoaded('preact', './x.tsx')).toThrow(/preact island plugin/);
  });
});
