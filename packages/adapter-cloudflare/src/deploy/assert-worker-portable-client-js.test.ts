import { describe, test, expect } from 'vitest';
import { assertWorkerPortableClientJS } from './assert-worker-portable-client-js';

describe('assertWorkerPortableClientJS', () => {
  test('accepts a build with no path identities', () => {
    expect(() => assertWorkerPortableClientJS([])).not.toThrow();
  });

  test('rejects a path identity, which cannot be rebuilt on a Worker', () => {
    const pathIdentities = [
      {
        modulePath: 'file:///proj/app/client/x.ts',
        identityKey: 'app/client/x.ts',
      },
    ];

    expect(() => assertWorkerPortableClientJS(pathIdentities)).toThrow(
      /cannot be resolved on a Cloudflare Worker/
    );
    expect(() => assertWorkerPortableClientJS(pathIdentities)).toThrow(
      /file:\/\/\/proj\/app\/client\/x\.ts/
    );
    expect(() => assertWorkerPortableClientJS(pathIdentities)).toThrow(/buildClientJS\('~\//);
  });

  test('counts every offending script', () => {
    expect(() =>
      assertWorkerPortableClientJS([
        { modulePath: 'file:///proj/a.ts', identityKey: 'a.ts' },
        { modulePath: 'file:///proj/b.ts', identityKey: 'b.ts' },
      ])
    ).toThrow(/2 client scripts cannot be resolved/);
  });
});
