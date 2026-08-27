import { describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  syncWranglerCssAliases,
  MARKER_START,
  MARKER_END,
  resolveCssStubPath,
} from './sync-wrangler-css-aliases';

describe('sync-wrangler-css-aliases', () => {
  test('appends alias block when markers are missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-wrangler-sync-'));
    writeFileSync(join(root, 'wrangler.toml'), `name = "test-worker"\nmain = "./dist/server.ts"\n`);

    const stubPath = resolveCssStubPath(root);
    const result = syncWranglerCssAliases(root, {
      specifiers: ['../styles/globals.css', 'app/styles/globals.css'],
    });

    expect(result.updated).toBe(true);
    expect(result.aliasCount).toBe(2);

    const content = readFileSync(join(root, 'wrangler.toml'), 'utf-8');
    expect(content).toContain('name = "test-worker"');
    expect(content).toContain(MARKER_START);
    expect(content).toContain(MARKER_END);
    expect(content).toContain(`"../styles/globals.css" = "${stubPath}"`);
    expect(content).toContain(`"app/styles/globals.css" = "${stubPath}"`);
  });

  test('replaces existing alias block and preserves other config', () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-wrangler-sync-'));
    writeFileSync(
      join(root, 'wrangler.toml'),
      `name = "test-worker"
main = "./dist/server.ts"

${MARKER_START}
[alias]
"old.css" = "./old.css"
${MARKER_END}

[[kv_namespaces]]
binding = "TODO_KV"
id = "abc"
`
    );

    syncWranglerCssAliases(root, { specifiers: ['app/styles/globals.css'] });

    const content = readFileSync(join(root, 'wrangler.toml'), 'utf-8');
    expect(content).toContain('name = "test-worker"');
    expect(content).toContain('binding = "TODO_KV"');
    expect(content).not.toContain('"old.css"');
    expect(content).toContain('"app/styles/globals.css"');
  });

  test('does not rewrite wrangler.toml when aliases are already current', () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-wrangler-sync-'));
    writeFileSync(join(root, 'wrangler.toml'), `name = "test-worker"\nmain = "./dist/server.ts"\n`);

    const first = syncWranglerCssAliases(root, { specifiers: ['app/styles/globals.css'] });
    expect(first.updated).toBe(true);

    const before = readFileSync(join(root, 'wrangler.toml'), 'utf-8');
    const second = syncWranglerCssAliases(root, { specifiers: ['app/styles/globals.css'] });
    expect(second.updated).toBe(false);
    expect(readFileSync(join(root, 'wrangler.toml'), 'utf-8')).toBe(before);
  });
});
