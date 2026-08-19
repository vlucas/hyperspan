import { describe, test, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildClientJS,
  getClientJSEntries,
  registerPathAliases,
  resetClientJSEntriesForTests,
} from '@hyperspan/framework/client/js';
import {
  clientJSPlugin,
  resolveClientJSSource,
  bundleIifeClientJS,
  bundleClientJSDev,
  clientJSRollupInput,
  clientJSFileGroups,
  buildRegisteredClientJS,
} from './client-js';

describe('clientJSPlugin', () => {
  beforeEach(() => {
    resetClientJSEntriesForTests();
  });

  test('clientJSRollupInput includes module entries and skips iife', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hs-vite-client-'));
    const moduleFile = join(dir, 'widget.ts');
    const iifeFile = join(dir, 'stream.ts');
    writeFileSync(moduleFile, 'export function init() {}');
    writeFileSync(iifeFile, 'export function boot() {}');

    await buildClientJS(moduleFile);
    await buildClientJS(iifeFile, { type: 'iife' });

    const input = clientJSRollupInput();
    const moduleEntry = getClientJSEntries().find((entry) => entry.absPath === moduleFile)!;
    const iifeEntry = getClientJSEntries().find((entry) => entry.absPath === iifeFile)!;

    expect(input[moduleEntry.esmName]).toBe(moduleFile);
    expect(input[iifeEntry.esmName]).toBeUndefined();
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

  test('iife buildClientJS entries bundle without import/export', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hs-vite-iife-'));
    writeFileSync(join(dir, 'dep.ts'), 'export const n = 1;\n');
    const clientFile = join(dir, 'boot.ts');
    writeFileSync(clientFile, `import { n } from './dep.ts';\nconsole.log(n);\n`);

    await buildClientJS(clientFile, { type: 'iife' });
    const entry = getClientJSEntries().find((item) => item.absPath === clientFile);
    expect(entry?.type).toBe('iife');
    const code = await bundleIifeClientJS(clientFile);
    expect(code).not.toMatch(/\bimport\s+/);
    expect(code).not.toMatch(/\bexport\s+/);
  });

  test('module buildClientJS entries bundle as ESM for dev serving', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hs-vite-esm-'));
    writeFileSync(join(dir, 'dep.ts'), 'export const n = 1;\n');
    const clientFile = join(dir, 'widget.ts');
    writeFileSync(
      clientFile,
      `import { n } from './dep.ts';\nexport function init() { return n; }\n`
    );

    await buildClientJS(clientFile);
    const code = await bundleClientJSDev(clientFile, 'module');
    expect(code).toMatch(/\bexport\b/);
    expect(code).not.toMatch(/\bimport\s+.*from\s+['"]\.\//);
  });

  // One file reached by two specifiers is two identities but must build once.
  test('two identities for one file collapse to a single group and rollup input', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hs-vite-dedupe-'));
    const clientFile = join(dir, 'widget.ts');
    writeFileSync(clientFile, 'export function init() {}');
    registerPathAliases({ '~/': `${dir}/`, '~': dir });

    const viaAlias = await buildClientJS('~/widget.ts');
    const viaPath = await buildClientJS(clientFile);
    expect(viaAlias.esmName).not.toBe(viaPath.esmName);

    const groups = clientJSFileGroups('module');
    expect(groups).toHaveLength(1);
    expect(groups[0].absPath).toBe(clientFile);
    expect(groups[0].esmNames).toEqual([viaAlias.esmName, viaPath.esmName].sort());

    const input = clientJSRollupInput();
    expect(Object.keys(input)).toHaveLength(1);
    expect(Object.values(input)).toEqual([clientFile]);
  });

  test('canonical identity is stable regardless of registration order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hs-vite-canonical-'));
    const clientFile = join(dir, 'widget.ts');
    writeFileSync(clientFile, 'export function init() {}');
    registerPathAliases({ '~/': `${dir}/`, '~': dir });

    await buildClientJS('~/widget.ts');
    await buildClientJS(clientFile);
    const first = clientJSFileGroups('module')[0].canonical;

    resetClientJSEntriesForTests();
    registerPathAliases({ '~/': `${dir}/`, '~': dir });
    await buildClientJS(clientFile);
    await buildClientJS('~/widget.ts');

    expect(clientJSFileGroups('module')[0].canonical).toBe(first);
  });

  test('buildRegisteredClientJS emits one content-addressed file for both identities', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hs-vite-content-'));
    const clientFile = join(dir, 'boot.ts');
    writeFileSync(clientFile, 'console.log(1);\n');
    registerPathAliases({ '~/': `${dir}/`, '~': dir });

    const viaAlias = await buildClientJS('~/boot.ts', { type: 'iife' });
    const viaPath = await buildClientJS(clientFile, { type: 'iife' });

    const outDir = join(dir, 'dist');
    const imports = await buildRegisteredClientJS(dir, outDir);

    expect(imports[viaAlias.esmName]).toMatch(/^\/_hs\/js\/client-[0-9a-f]{16}\.js$/);
    expect(imports[viaPath.esmName]).toBe(imports[viaAlias.esmName]);
    expect(readdirSync(join(outDir, '_hs', 'js'))).toHaveLength(1);
  });

  test('identical content from different files collapses to one file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hs-vite-same-content-'));
    const a = join(dir, 'a.ts');
    const b = join(dir, 'b.ts');
    writeFileSync(a, 'console.log(1);\n');
    writeFileSync(b, 'console.log(1);\n');

    const first = await buildClientJS(a, { type: 'iife' });
    const second = await buildClientJS(b, { type: 'iife' });

    const outDir = join(dir, 'dist');
    const imports = await buildRegisteredClientJS(dir, outDir);

    expect(imports[second.esmName]).toBe(imports[first.esmName]);
    expect(readdirSync(join(outDir, '_hs', 'js'))).toHaveLength(1);
  });
});
