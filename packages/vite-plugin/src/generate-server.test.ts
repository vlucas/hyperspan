import { describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectRouteModuleSpecs,
  createServerEntryTemplate,
  resolveDeployAdapter,
  writeServerEntry,
} from './generate-server';
import type { Adapter } from '@hyperspan/framework';

const routeSpec = {
  relativeFilePath: 'index.ts',
  importPath: '../app/routes/index.ts',
  importId: '__hs_routes_index_ts',
};

const fetchPlatformAdapter: Adapter = {
  name: 'fetch-platform',
  renderServerEntry: (template) =>
    template({
      beforeFileContent: "import './platform-polyfills';",
      afterFileContent: `export default createPlatformEntry({
  createHyperspanServer,
  config: hyperspanConfig,
});
`,
    }),
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
  });

  test('default template is shared bootstrap only', () => {
    const source = createServerEntryTemplate({
      configImportPath: '../hyperspan.config.ts',
      routeSpecs: [routeSpec],
    })();

    expect(source).toContain(
      'export async function createHyperspanServer({ env }: ServerCreateContext)'
    );
    expect(source).toContain('await hyperspanConfig.beforeServerCreate?.({ env })');
    expect(source).toContain('initServerRoutes');
    expect(source).toMatch(/}\);\n\n  await initServerRoutes/);
    expect(source).not.toContain('createEntry');
    expect(source).not.toContain('export async function start(');
    expect(source).not.toContain('export default');
    expect(source).not.toContain('@hyperspan/adapter-node');
    expect(source).not.toContain('@hyperspan/adapter-cloudflare');
  });

  test('null and omitted slots do not insert extra lines', () => {
    const template = createServerEntryTemplate({
      configImportPath: '../hyperspan.config.ts',
      routeSpecs: [routeSpec],
    });
    const withNulls = template({
      beforeFileContent: null,
      beforeCreateServer: null,
      afterCreateServer: null,
      beforeRoutes: null,
      afterRoutes: null,
      afterFileContent: null,
    });

    expect(withNulls).toBe(template());
    expect(withNulls).not.toContain('null');
  });

  test('afterFileContent slot adds the platform entry block', () => {
    const source = createServerEntryTemplate({
      configImportPath: '../hyperspan.config.ts',
      routeSpecs: [routeSpec],
    })({
      beforeFileContent: "import './custom-prelude';",
      afterFileContent: 'export default { fetch() { return new Response("ok"); } }',
    });

    expect(source).toContain("import './custom-prelude';");
    expect(source).toContain('export default { fetch()');
    expect(source).not.toContain('createEntry');
  });

  test('writeServerEntry uses nodeAdapter renderServerEntry by default', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-write-server-'));
    mkdirSync(join(root, 'app/routes'), { recursive: true });
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'app/routes/index.ts'), 'export default {}');

    await writeServerEntry({
      root,
      outDir: join(root, 'dist'),
      appDir: './app',
    });

    const source = readFileSync(join(root, 'dist/server.ts'), 'utf8');
    expect(source).toContain("import { createNodeDeployEntry } from '@hyperspan/adapter-node'");
    expect(source).toContain('export async function start(');
    expect(source).toContain('export default __hs_entry');
    expect(source).not.toContain('deployAdapter.createEntry');
  });

  test('writeServerEntry writes fetch-only afterFileContent from renderServerEntry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-write-server-fetch-'));
    mkdirSync(join(root, 'app/routes'), { recursive: true });
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'app/routes/index.ts'), 'export default {}');

    await writeServerEntry({
      root,
      outDir: join(root, 'dist'),
      appDir: './app',
      adapter: fetchPlatformAdapter,
    });

    const source = readFileSync(join(root, 'dist/server.ts'), 'utf8');
    expect(source).toContain("import './platform-polyfills';");
    expect(source).toContain('export default createPlatformEntry');
    expect(source).not.toContain('export async function start(');
  });

  test('writeServerEntry writes a fully custom renderServerEntry string', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-write-server-custom-'));
    mkdirSync(join(root, 'app/routes'), { recursive: true });
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'app/routes/index.ts'), 'export default {}');

    const customAdapter: Adapter = {
      name: 'custom',
      renderServerEntry: () => 'export default { fetch() { return new Response("ok"); } }\n',
    };

    await writeServerEntry({
      root,
      outDir: join(root, 'dist'),
      appDir: './app',
      adapter: customAdapter,
    });

    expect(readFileSync(join(root, 'dist/server.ts'), 'utf8')).toBe(
      'export default { fetch() { return new Response("ok"); } }\n'
    );
  });
});
