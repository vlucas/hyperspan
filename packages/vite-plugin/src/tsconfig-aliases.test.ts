import { describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  aliasesFromTsconfig,
  createAppJiti,
  resolveAliasedSpecifier,
  resolveModuleAliases,
} from './tsconfig-aliases';

function writeApp(paths: Record<string, string[]>, files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'hs-tsconfig-aliases-'));
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths,
      },
    })
  );
  for (const [relative, source] of Object.entries(files)) {
    const file = join(root, relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, source);
  }
  return root;
}

describe('tsconfig aliases', () => {
  test('maps ~/* and @/* without stealing scoped packages via bare @', () => {
    const root = writeApp(
      {
        '~/*': ['./*'],
        '@/*': ['./src/*'],
      },
      {}
    );

    const aliases = aliasesFromTsconfig(root);
    expect(aliases['~/']).toBe(`${root}/`);
    expect(aliases['~']).toBe(root);
    expect(aliases['@/']).toBe(`${join(root, 'src')}/`);
    expect(aliases['@']).toBeUndefined();
  });

  test('parses ~/* paths when include globs contain */', () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-tsconfig-globs-'));
    writeFileSync(
      join(root, 'tsconfig.json'),
      `{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "~/*": ["./*"],
      "@/*": ["./src/*"]
    }
  },
  "include": ["app/**/*.ts", "app/**/*.tsx", "src/**/*.ts"]
}`
    );

    const aliases = aliasesFromTsconfig(root);
    expect(aliases['~/']).toBe(`${root}/`);
    expect(aliases['~']).toBe(root);
    expect(aliases['@/']).toBe(`${join(root, 'src')}/`);
  });

  test('parses comments and trailing commas in tsconfig', () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-tsconfig-jsonc-'));
    writeFileSync(
      join(root, 'tsconfig.json'),
      `{
  // app aliases
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "~/*": ["./*"], // project root
      "@/*": ["./src/*"],
    },
  },
  /* glob includes */
  "include": ["app/**/*.ts", "src/**/*.ts"],
}`
    );

    const aliases = aliasesFromTsconfig(root);
    expect(aliases['~/']).toBe(`${root}/`);
    expect(aliases['@/']).toBe(`${join(root, 'src')}/`);
  });

  test('returns no aliases when tsconfig has no paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'hs-tsconfig-nopaths-'));
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }));

    expect(resolveModuleAliases(root)).toEqual({});
  });

  test('resolveAliasedSpecifier uses the longest matching prefix', () => {
    const resolved = resolveAliasedSpecifier('~/src/lib/session', {
      '~': '/app',
      '~/': '/app/',
    });
    expect(resolved).toBe('/app/src/lib/session');
  });

  test('createAppJiti resolves ~/ imports from hyperspan.config.ts', () => {
    const root = writeApp(
      { '~/*': ['./*'] },
      {
        'src/lib/session.ts': 'export const answer = 42;\n',
        'src/middleware.ts': `import { answer } from '~/src/lib/session';\nexport const value = answer;\n`,
        'hyperspan.config.ts': `import { value } from './src/middleware';\nexport default { value };\n`,
      }
    );

    const config = createAppJiti(root)(join(root, 'hyperspan.config.ts')) as { value: number };
    expect(config.value).toBe(42);
  });

  test('createAppJiti can load TSX modules', () => {
    const root = writeApp(
      {},
      {
        'widget.tsx': `export const label = 'ok';\nexport default function Widget() { return <span>{label}</span>; }\n`,
      }
    );

    const mod = createAppJiti(root)(join(root, 'widget.tsx')) as { label: string };
    expect(mod.label).toBe('ok');
  });
});
