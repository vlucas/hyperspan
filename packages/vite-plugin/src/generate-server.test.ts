import { describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectRouteModuleSpecs, generateServerSource } from './generate-server';

const routeSpec = {
  relativeFilePath: 'index.ts',
  importPath: '../app/routes/index.ts',
  importId: '__hs_routes_index_ts',
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

  test('generateServerSource emits node start() with beforeServerCreate({ env })', () => {
    const source = generateServerSource({
      configImportPath: '../hyperspan.config.ts',
      routeSpecs: [routeSpec],
      deployTarget: 'node',
    });

    expect(source).toContain("import { startNodeServer } from '@hyperspan/adapter-node'");
    expect(source).toContain('export async function createHyperspanServer()');
    expect(source).toContain('export async function start(');
    expect(source).toContain('beforeServerCreate({ env: process.env })');
    expect(source).not.toContain('createCloudflareHandler');
    expect(source).not.toContain('export default {');
  });

  test('generateServerSource emits bun start() with beforeServerCreate({ env })', () => {
    const source = generateServerSource({
      configImportPath: '../hyperspan.config.ts',
      routeSpecs: [routeSpec],
      deployTarget: 'bun',
    });

    expect(source).toContain("import { startBunServer } from '@hyperspan/adapter-bun'");
    expect(source).toContain('export async function start(');
    expect(source).toContain('beforeServerCreate({ env: process.env })');
    expect(source).not.toContain('startNodeServer');
  });

  test('generateServerSource wires cloudflare adapter for cloudflare target', () => {
    const source = generateServerSource({
      configImportPath: '../hyperspan.config.ts',
      routeSpecs: [routeSpec],
      deployTarget: 'cloudflare',
    });

    expect(source).toContain(
      "import { createCloudflareHandler } from '@hyperspan/adapter-cloudflare'"
    );
    expect(source).toContain('export async function createHyperspanServer()');
    expect(source).toContain('beforeServerCreate({ env })');
    expect(source).not.toContain('beforeServerCreate({ env: process.env })');
    expect(source).toContain('export default {');
    expect(source).toContain('satisfies ExportedHandler');
  });
});
