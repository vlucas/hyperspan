import { describe, test, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildClientJS,
  getClientJSEntries,
  resetClientJSEntriesForTests,
} from '@hyperspan/framework/client/js';
import { clientJSPlugin } from './client-js';

describe('clientJSPlugin', () => {
  beforeEach(() => {
    resetClientJSEntriesForTests();
  });

  test('resolveId maps public client URL to virtual module', async () => {
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

    expect(resolved).toBe(`\0hyperspan-client-js:${clientFile}`);
  });

  test('load returns re-export stub for source file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hs-vite-client-'));
    const clientFile = join(dir, 'widget.ts');
    writeFileSync(clientFile, 'export function init() {}');

    await buildClientJS(clientFile);
    const plugin = clientJSPlugin();
    const code = await plugin.load?.(`\0hyperspan-client-js:${clientFile}`);

    expect(code).toContain(`export * from ${JSON.stringify(clientFile)}`);
  });
});
