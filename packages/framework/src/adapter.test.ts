import { describe, expect, test } from 'bun:test';
import type { Adapter } from './types';
import { createConfig } from './server';

const cloudflare: Adapter = {
  name: 'cloudflare',
  renderServerEntry: (template) => template(),
};

describe('createConfig deployAdapter', () => {
  test('defaults to Node when omitted or undefined', () => {
    expect(createConfig({}).deployAdapter.name).toBe('node');
    expect(createConfig({ deployAdapter: undefined }).deployAdapter.name).toBe('node');
  });

  test('keeps an explicit adapter', () => {
    expect(createConfig({ deployAdapter: cloudflare }).deployAdapter).toBe(cloudflare);
  });
});
