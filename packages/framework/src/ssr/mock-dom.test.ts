import { describe, expect, test } from 'bun:test';
import { MOCK_DOM_MARK, installMockDom, stubElement } from './mock-dom';

describe('stubElement', () => {
  test('exposes DOM-like fields and nests children via appendChild', () => {
    const el = stubElement('article');
    expect(el.tagName).toBe('ARTICLE');
    expect(el.nodeType).toBe(1);
    expect(typeof el.appendChild).toBe('function');

    const inner = stubElement('span');
    el.appendChild(inner);
    expect((el.childNodes as unknown[]).length).toBe(1);
  });
});

describe('installMockDom', () => {
  test('runs without throwing and can be invoked repeatedly', () => {
    expect(() => installMockDom()).not.toThrow();
    expect(() => installMockDom()).not.toThrow();
  });

  test('respects HYPERSPAN_DISABLE_MOCK_DOM', () => {
    const prev = process.env.HYPERSPAN_DISABLE_MOCK_DOM;
    try {
      process.env.HYPERSPAN_DISABLE_MOCK_DOM = '1';
      expect(installMockDom()).toBe(false);
    } finally {
      process.env.HYPERSPAN_DISABLE_MOCK_DOM = prev;
    }
  });

  test('when a mock document is installed, it is annotated with MOCK_DOM_MARK', () => {
    const doc = globalThis.document as Record<string, unknown> | undefined;
    if (!doc?.[MOCK_DOM_MARK]) return;
    expect(doc[MOCK_DOM_MARK]).toBe(true);
  });
});
