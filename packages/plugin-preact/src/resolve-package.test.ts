import { describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  preactSingletonAliases,
  resolvePackageDir,
  resolvePackageFrom,
  resolvePreactSpecifier,
} from './resolve-package';

function fakePackage(root: string, name: string, file = 'index.js') {
  const dir = join(root, 'node_modules', ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, main: file }));
  writeFileSync(join(dir, file), 'export {}\n');
  mkdirSync(join(dir, 'hooks'), { recursive: true });
  writeFileSync(
    join(dir, 'hooks', 'package.json'),
    JSON.stringify({ name: `${name}/hooks`, main: 'index.js' })
  );
  writeFileSync(join(dir, 'hooks', 'index.js'), 'export {}\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', type: 'module' }));
  return realpathSync(dir);
}

describe('resolvePackageFrom', () => {
  test('resolves a package from the starting directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-preact-resolve-'));
    const dir = fakePackage(root, 'preact');
    expect(resolvePackageFrom(root, 'preact')).toBe(join(dir, 'index.js'));
    expect(resolvePackageDir(root, 'preact')).toBe(dir);
  });

  test('prefers the app copy when pinning preact', () => {
    const app = mkdtempSync(join(tmpdir(), 'hs-preact-app-'));
    const plugin = mkdtempSync(join(tmpdir(), 'hs-preact-plugin-'));
    const appPreact = fakePackage(app, 'preact');
    fakePackage(plugin, 'preact');

    expect(preactSingletonAliases(app, plugin)).toEqual({ preact: appPreact });
    expect(resolvePreactSpecifier('preact/hooks', app, plugin)).toContain(join(appPreact, 'hooks'));
  });

  test('falls back to the plugin copy when the app has no preact', () => {
    const app = mkdtempSync(join(tmpdir(), 'hs-preact-empty-'));
    const plugin = mkdtempSync(join(tmpdir(), 'hs-preact-plugin-'));
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'app' }));
    const pluginPreact = fakePackage(plugin, 'preact');

    expect(preactSingletonAliases(app, plugin)).toEqual({ preact: pluginPreact });
    expect(resolvePreactSpecifier('preact', app, plugin)).toBe(join(pluginPreact, 'index.js'));
  });

  test('resolves preact-render-to-string from the plugin when the app lacks it', () => {
    const app = mkdtempSync(join(tmpdir(), 'hs-prerender-app-'));
    const plugin = mkdtempSync(join(tmpdir(), 'hs-prerender-plugin-'));
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'app' }));
    const prerender = fakePackage(plugin, 'preact-render-to-string');
    expect(resolvePreactSpecifier('preact-render-to-string', app, plugin)).toBe(
      join(prerender, 'index.js')
    );
  });

  test('ignores non-preact specifiers', () => {
    expect(resolvePreactSpecifier('vue', '/', '/')).toBeUndefined();
  });
});
