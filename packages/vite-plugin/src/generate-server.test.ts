import { describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectRouteModuleSpecs,
  generateServerSource,
  resolveDeployAdapter,
} from './generate-server';
import type { Adapter } from '@hyperspan/framework';

const routeSpec = {
  relativeFilePath: 'index.ts',
  importPath: '../app/routes/index.ts',
  importId: '__hs_routes_index_ts',
};

const cloudflareAdapter: Adapter = {
  name: 'cloudflare',
  createEntry() {
    return {
      fetch: async () => new Response('ok'),
    };
  },
};

describe('generate-server', () => {
  test('collectRouteModuleSpecs finds routes and actions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-gen-server-'));
    mkdirSync(join(root, 'app/routes'), { recursive: true });
    mkdirSync(join(root, 'app/actions'), { recursive: true });
    writeFileSync(join(root, 'app/routes/index.ts'), 'export default {}');
    writeFileSync(join(root, 'app/actions/add.ts'), 'export default {}');

    const specs = await collectRouteModuleSpecs(root, './app');

    expect(specs).toHaveLength(2);
    expect(specs.map((s) => s.relativeFilePath).sort()).toEqual(['add.ts', 'index.ts']);
    expect(specs[0].importPath).toMatch(/^\.\.\/app\/(routes|actions)\//);
  });

  test('resolveDeployAdapter defaults to Node when omitted', () => {
    expect(resolveDeployAdapter().name).toBe('node');
    expect(resolveDeployAdapter(undefined).name).toBe('node');
    expect(resolveDeployAdapter(cloudflareAdapter)).toBe(cloudflareAdapter);
  });

  test('generateServerSource always calls createEntry', () => {
    const source = generateServerSource({
      configImportPath: '../hyperspan.config.ts',
      routeSpecs: [routeSpec],
    });

    expect(source).toContain('hyperspanConfig.deployAdapter.createEntry({');
    expect(source).toContain('export async function start(');
    expect(source).toContain('export default __hs_entry');
    expect(source).toContain('initServerRoutes');
    expect(source).not.toContain('if (hyperspanConfig.beforeRoutesAdded)');
    expect(source).not.toContain('@hyperspan/adapter-node');
    expect(source).not.toContain('@hyperspan/adapter-cloudflare');
  });
});
