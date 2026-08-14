import { describe, test, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildClientJS,
  getClientJSEntries,
  resetClientJSEntriesForTests,
} from '@hyperspan/framework/client/js';
import { clientJSPlugin, resolveClientJSSource } from './client-js';

describe('clientJSPlugin', () => {
  beforeEach(() => {
    resetClientJSEntriesForTests();
  });

  test('resolveId maps buildClientJS public URL to the source file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hs-vite-client-'));
    const clientFile = join(dir, 'widget.ts');
    writeFileSync(clientFile, 'export function init() {}');

    await buildClientJS(clientFile);
    const entry = getClientJSEntries()[0];
    const plugin = clientJSPlugin();
    const resolved = await plugin.resolveId?.(
      `/_hs/js/${entry.esmName}.js`,
      undefined,
      {} as never
    );

    expect(resolved).toBe(clientFile);
  });

  test('resolveClientJSSource finds buildClientJS entries when Vite prefixes the project root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hs-vite-client-'));
    const clientFile = join(dir, 'widget.ts');
    writeFileSync(clientFile, 'export function mount() {}');

    await buildClientJS(clientFile);
    const entry = getClientJSEntries()[0];

    expect(resolveClientJSSource(`/project${entry.publicPath}`)).toBe(clientFile);
  });

  test('resolveId maps framework action client URL to source file', async () => {
    const plugin = clientJSPlugin();
    const resolved = await plugin.resolveId?.(
      '/_hs/js/hyperspan-actions.client.js',
      undefined,
      {} as never
    );

    expect(resolved).toMatch(/hyperspan-actions\.client\.ts$/);
  });
});
