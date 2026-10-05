import { describe, expect, test } from 'vitest';
import { isViteHandledPath } from './is-vite-handled-path';

describe('isViteHandledPath', () => {
  test('passes Vite internals and node_modules to Vite', () => {
    expect(isViteHandledPath('/@vite/client')).toBe(true);
    expect(isViteHandledPath('/@fs/app/foo.ts')).toBe(true);
    expect(isViteHandledPath('/__vite_ping')).toBe(true);
    expect(isViteHandledPath('/node_modules/vite/dist/client.js')).toBe(true);
  });

  test('passes asset paths by extension on the pathname', () => {
    expect(isViteHandledPath('/app/client/picker.ts')).toBe(true);
    expect(isViteHandledPath('/_hs/js/client-abc.js')).toBe(true);
    expect(isViteHandledPath('/assets/app.css')).toBe(true);
    expect(isViteHandledPath('/widgets/Counter.vue')).toBe(true);
    expect(isViteHandledPath('/widgets/Counter.svelte')).toBe(true);
    expect(isViteHandledPath('/src/foo.json')).toBe(true);
    expect(isViteHandledPath('/src/foo.json?import')).toBe(true);
    expect(isViteHandledPath('/src/data.JSON?t=1')).toBe(true);
  });

  test('does not skip Hyperspan routes when query contains asset-like substrings', () => {
    expect(isViteHandledPath('/search?q=file.js')).toBe(false);
    expect(isViteHandledPath('/docs?ext=.ts')).toBe(false);
    expect(isViteHandledPath('/page?redirect=/app.css')).toBe(false);
    expect(isViteHandledPath('/api/data?format=.json')).toBe(false);
  });

  test('does not skip routes whose path contains asset substrings mid-segment', () => {
    expect(isViteHandledPath('/docs/introducing-typescript')).toBe(false);
    expect(isViteHandledPath('/blog/learning.js-basics')).toBe(false);
    expect(isViteHandledPath('/blog/learning.json-basics')).toBe(false);
    expect(isViteHandledPath('/')).toBe(false);
    expect(isViteHandledPath('/todos')).toBe(false);
  });
});
