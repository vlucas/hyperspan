import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, resolveConfig } from 'vite';
import { describe, expect, test } from 'vitest';
import { hyperspan } from './index';

describe('vite publicDir', () => {
  test('publicDir: false is not copied into the client build', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-public-'));
    mkdirSync(join(root, 'public'));
    writeFileSync(join(root, 'public', 'hello.txt'), 'hi');
    writeFileSync(join(root, 'index.html'), '<h1>x</h1>');
    writeFileSync(join(root, 'hyperspan.config.ts'), 'export default {};\n');

    const plugins = [...hyperspan()];
    const resolved = await resolveConfig(
      {
        configFile: false,
        root,
        publicDir: false,
        plugins,
        logLevel: 'silent',
      },
      'build'
    );
    expect(resolved.publicDir).toBe('');

    process.env.HYPERSPAN_SKIP_BUILD_DISCOVERY = '1';
    try {
      await build({
        configFile: false,
        root,
        publicDir: false,
        plugins: [...hyperspan()],
        logLevel: 'silent',
        build: { outDir: 'dist', emptyOutDir: true },
      });
    } finally {
      delete process.env.HYPERSPAN_SKIP_BUILD_DISCOVERY;
    }

    expect(existsSync(join(root, 'dist', 'hello.txt'))).toBe(false);
    expect(readdirSync(join(root, 'dist'))).not.toContain('hello.txt');
  });

  test('route CSS is emitted under /_hs/css when publicDir is false', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-css-'));
    mkdirSync(join(root, 'public'));
    writeFileSync(join(root, 'public', 'hello.txt'), 'hi');
    writeFileSync(join(root, 'index.html'), '<h1>x</h1>');
    writeFileSync(join(root, 'hyperspan.config.ts'), 'export default { appDir: "./app" };\n');
    mkdirSync(join(root, 'app/routes'), { recursive: true });
    mkdirSync(join(root, 'app/styles'), { recursive: true });
    writeFileSync(join(root, 'app/styles/page.css'), 'h1 { color: rgb(1, 2, 3); }\n');
    writeFileSync(
      join(root, 'app/routes/index.ts'),
      `import '../styles/page.css';
import { createRoute } from '@hyperspan/framework';
export default createRoute().get(() => new Response('ok'));
`
    );
    symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'));

    await build({
      configFile: false,
      root,
      publicDir: false,
      plugins: [...hyperspan()],
      logLevel: 'silent',
      build: { outDir: 'dist', emptyOutDir: true },
    });

    const cssDir = join(root, 'dist/_hs/css');
    expect(existsSync(cssDir)).toBe(true);
    const cssFiles = readdirSync(cssDir).filter((name) => name.endsWith('.css'));
    expect(cssFiles.length).toBeGreaterThan(0);
    expect(readFileSync(join(cssDir, cssFiles[0]), 'utf8')).toContain('rgb(1, 2, 3)');

    const manifest = JSON.parse(readFileSync(join(root, 'dist/manifest.json'), 'utf8')) as {
      css?: Record<string, string[]>;
    };
    const linked = Object.values(manifest.css ?? {}).flat();
    expect(linked.some((href) => href.startsWith('/_hs/css/') && href.endsWith('.css'))).toBe(true);
    expect(existsSync(join(root, 'dist', 'hello.txt'))).toBe(false);
  });
});
