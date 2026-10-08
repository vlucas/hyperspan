import { describe, test, expect } from 'vitest';
import { resolveWithoutRuntimeResolver } from './polyfills';

describe('resolveWithoutRuntimeResolver', () => {
  // workerd has no `import.meta.url`, so the base is `undefined` and `new URL` throws
  // `Invalid URL string` — the crash that took the Worker down at module load.
  test('returns the specifier when there is no base to resolve against', () => {
    expect(resolveWithoutRuntimeResolver('~/app/client/x.ts', undefined)).toBe('~/app/client/x.ts');
    expect(resolveWithoutRuntimeResolver('~/app/client/x.ts', '')).toBe('~/app/client/x.ts');
  });

  test('returns the specifier instead of throwing on an unusable base', () => {
    expect(resolveWithoutRuntimeResolver('./x.ts', 'not-a-url')).toBe('./x.ts');
  });

  test('resolves against a real base when one exists', () => {
    expect(resolveWithoutRuntimeResolver('./x.ts', 'file:///app/routes/index.ts')).toBe(
      'file:///app/routes/x.ts'
    );
  });
});
