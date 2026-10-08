import { describe, test, expect } from 'vitest';
import { renderIsland } from './island';

describe('renderIsland', () => {
  test('throws when component has no __HS_ISLAND', () => {
    expect(() => renderIsland({ name: 'Bare' } as never, {})).toThrow(/not a Hyperspan island/i);
  });

  test('returns html.raw for sync island render', () => {
    const component = {
      name: 'Counter',
      __HS_ISLAND: {
        render: () => '<div id="x">1</div>',
      },
    };
    const result = renderIsland(component, { count: 1 });
    expect(result).toHaveProperty('_kind', 'html_safe');
    expect((result as { content: string }).content).toContain('<div id="x">1</div>');
  });

  test('awaits async island render', async () => {
    const component = {
      __HS_ISLAND: {
        render: async () => '<div>async</div>',
      },
    };
    const result = await renderIsland(component, {});
    expect(result.content).toContain('<div>async</div>');
  });
});
