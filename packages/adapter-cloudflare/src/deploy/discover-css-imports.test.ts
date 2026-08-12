import { describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  discoverCssImportSpecifiers,
  extractCssImportsFromSource,
  expandCssImportSpecifiers,
} from './discover-css-imports';

describe('discover-css-imports', () => {
  test('extractCssImportsFromSource finds side-effect CSS imports', () => {
    const source = `
      import '../styles/globals.css';
      import { html } from '@hyperspan/html';
      import "~/app/styles/test.css";
    `;

    expect(extractCssImportsFromSource(source)).toEqual([
      '../styles/globals.css',
      '~/app/styles/test.css',
    ]);
  });

  test('expandCssImportSpecifiers includes literal and resolved paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-css-discover-'));
    mkdirSync(join(root, 'app/layouts'), { recursive: true });
    mkdirSync(join(root, 'app/styles'), { recursive: true });
    writeFileSync(join(root, 'app/styles/globals.css'), 'body {}');
    const importer = join(root, 'app/layouts/app-layout.ts');

    const keys = expandCssImportSpecifiers(root, importer, '../styles/globals.css');

    expect(keys).toContain('../styles/globals.css');
    expect(keys).toContain('app/styles/globals.css');
  });

  test('discoverCssImportSpecifiers scans app sources', () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-css-discover-'));
    mkdirSync(join(root, 'app/layouts'), { recursive: true });
    mkdirSync(join(root, 'app/routes'), { recursive: true });
    mkdirSync(join(root, 'app/styles'), { recursive: true });
    writeFileSync(join(root, 'app/styles/globals.css'), 'body {}');
    writeFileSync(
      join(root, 'app/layouts/app-layout.ts'),
      "import '../styles/globals.css';\nexport default function Layout() {}"
    );
    writeFileSync(
      join(root, 'app/routes/index.ts'),
      "import '~/app/styles/index.css';\nexport default {}"
    );
    writeFileSync(join(root, 'app/styles/index.css'), 'h1 {}');

    const specifiers = discoverCssImportSpecifiers(root, './app');

    expect(specifiers).toContain('../styles/globals.css');
    expect(specifiers).toContain('app/styles/globals.css');
    expect(specifiers).toContain('~/app/styles/index.css');
    expect(specifiers).toContain('app/styles/index.css');
  });
});
