import { describe, expect, test } from 'vitest';
import { pathToFileURL } from 'node:url';
import { importMetaResolvePlugin, hyperspanImportMetaResolve } from './import-meta-resolve';

describe('importMetaResolvePlugin', () => {
  test('polyfills import.meta.resolve on modules that call it', () => {
    const plugin = importMetaResolvePlugin();
    const result = plugin.transform?.call(
      {} as never,
      `export const x = import.meta.resolve('./foo.ts');\n`,
      '/tmp/file.ts'
    ) as { code: string } | undefined;

    expect(result?.code).toContain('import.meta.resolve ??=');
    expect(result?.code).toContain("from 'virtual:hyperspan-import-meta-resolve'");
    expect(result?.code).toContain(`export const x = import.meta.resolve('./foo.ts');`);
  });

  test('leaves modules without import.meta.resolve unchanged', () => {
    const plugin = importMetaResolvePlugin();
    const result = plugin.transform?.call({} as never, `export const x = 1;\n`, '/tmp/file.ts');

    expect(result).toBeUndefined();
  });
});

describe('hyperspanImportMetaResolve', () => {
  const base = pathToFileURL('/tmp/app/routes/index.ts').href;

  test('resolves relative specifiers against the importer', () => {
    expect(hyperspanImportMetaResolve('../client/picker.ts', base)).toBe(
      pathToFileURL('/tmp/app/client/picker.ts').href
    );
  });

  test('resolves tsconfig aliases like ~/', () => {
    expect(
      hyperspanImportMetaResolve('~/app/client/picker.ts', base, {
        '~/': '/tmp/project/',
      })
    ).toBe(pathToFileURL('/tmp/project/app/client/picker.ts').href);
  });
});
