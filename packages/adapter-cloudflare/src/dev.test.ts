import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import { findWranglerConfigPath } from './dev';

describe('findWranglerConfigPath', () => {
  test('prefers wrangler.dev.jsonc over wrangler.jsonc', () => {
    const root = join(tmpdir(), `hs-cf-dev-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    try {
      writeFileSync(join(root, 'wrangler.jsonc'), '{}\n');
      writeFileSync(join(root, 'wrangler.dev.jsonc'), '{}\n');
      expect(findWranglerConfigPath(root)).toBe(join(root, 'wrangler.dev.jsonc'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('uses wrangler.jsonc when dev config is absent', () => {
    const root = join(tmpdir(), `hs-cf-dev-jsonc-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    try {
      writeFileSync(join(root, 'wrangler.jsonc'), '{}\n');
      expect(findWranglerConfigPath(root)).toBe(join(root, 'wrangler.jsonc'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns undefined when no config exists', () => {
    const root = join(tmpdir(), `hs-cf-dev-empty-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    try {
      expect(findWranglerConfigPath(root)).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
