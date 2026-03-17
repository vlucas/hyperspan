import { test, describe, expect } from 'bun:test';
import { h } from 'preact';
import { buildIslandHtml, renderPreactSSR, renderPreactIsland } from './index';

// ---------------------------------------------------------------------------
// Simple Preact components defined inline — no .tsx compilation needed
// ---------------------------------------------------------------------------

function Hello({ name = 'World', count = 0 }: { name?: string; count?: number }) {
  return h('div', { class: 'hello' }, [
    h('h1', null, `Hello ${name}!`),
    h('p', null, `Count: ${count}`),
  ]);
}

// ---------------------------------------------------------------------------
// buildIslandHtml
// ---------------------------------------------------------------------------

describe('buildIslandHtml', () => {
  const jsId = 'abc123';
  const componentName = 'Hello';
  const esmName = 'hello-component';

  test('wraps SSR content in a div with the island id', () => {
    const result = buildIslandHtml(jsId, componentName, esmName, '', '<p>SSR</p>');
    expect(result).toContain(`<div id="${jsId}">`);
    expect(result).toContain('<p>SSR</p>');
  });

  test('includes a module script tag with the correct source id', () => {
    const result = buildIslandHtml(jsId, componentName, esmName, 'console.log(1)', '');
    expect(result).toContain(`<script type="module" id="${jsId}_script" data-source-id="${jsId}">`);
    expect(result).toContain(`import ${componentName} from "${esmName}"`);
    expect(result).toContain('console.log(1)');
  });

  test('lazy loading wraps script in a template inside a hidden div', () => {
    const result = buildIslandHtml(jsId, componentName, esmName, '', '<p>SSR</p>', {
      loading: 'lazy',
    });
    expect(result).toContain('data-loading="lazy"');
    expect(result).toContain('<template>');
    expect(result).toContain('<p>SSR</p>');
  });

  test('eager loading (default) does not include a template tag', () => {
    const result = buildIslandHtml(jsId, componentName, esmName, '', '<p>SSR</p>');
    expect(result).not.toContain('data-loading="lazy"');
    expect(result).not.toContain('<template>');
  });
});

// ---------------------------------------------------------------------------
// renderPreactSSR
// ---------------------------------------------------------------------------

describe('renderPreactSSR', () => {
  test('renders a component to an HTML string', () => {
    const output = renderPreactSSR(Hello, { name: 'World' });
    expect(output).toContain('<div');
    expect(output).toContain('Hello World!');
  });

  test('passes props to the component', () => {
    const output = renderPreactSSR(Hello, { name: 'Alice', count: 42 });
    expect(output).toContain('Hello Alice!');
    expect(output).toContain('Count: 42');
  });

  test('uses component defaults when props are omitted', () => {
    const output = renderPreactSSR(Hello, {});
    expect(output).toContain('Hello World!');
    expect(output).toContain('Count: 0');
  });

  test('returns a string', () => {
    const output = renderPreactSSR(Hello, {});
    expect(typeof output).toBe('string');
  });

  test('escapes dangerous characters in prop values', () => {
    const output = renderPreactSSR(Hello, { name: '<script>alert(1)</script>' });
    expect(output).not.toContain('<script>alert');
  });
});

// ---------------------------------------------------------------------------
// renderPreactIsland
// ---------------------------------------------------------------------------

describe('renderPreactIsland', () => {
  test('throws when component has no __HS_ISLAND property', () => {
    expect(() => renderPreactIsland(Hello, {})).toThrow(
      'was not loaded with an island plugin'
    );
  });

  test('returns an html_safe object', () => {
    const jsId = 'island-test-1';
    const esmName = 'hello-ssr';
    (Hello as any).__HS_ISLAND = {
      id: jsId,
      render: (props: any, options: any = {}) => {
        const ssrContent = renderPreactSSR(Hello, props);
        const jsContent = `import { h as __hs_h, hydrate as __hs_hydrate } from 'preact';__hs_hydrate(__hs_h(Hello, ${JSON.stringify(props)}), document.getElementById("${jsId}"));`;
        return buildIslandHtml(jsId, 'Hello', esmName, jsContent, ssrContent, options);
      },
    };

    const result = renderPreactIsland(Hello, { name: 'World' });
    expect(result).toHaveProperty('_kind', 'html_safe');
  });

  test('island output contains SSR-rendered HTML', () => {
    const jsId = 'island-test-2';
    const esmName = 'hello-ssr';
    (Hello as any).__HS_ISLAND = {
      id: jsId,
      render: (props: any, options: any = {}) => {
        const ssrContent = renderPreactSSR(Hello, props);
        const jsContent = '';
        return buildIslandHtml(jsId, 'Hello', esmName, jsContent, ssrContent, options);
      },
    };

    const result = renderPreactIsland(Hello, { name: 'Alice', count: 7 });
    expect(result.content).toContain('Hello Alice!');
    expect(result.content).toContain('Count: 7');
  });

  test('island output contains the wrapper div with the correct id', () => {
    const jsId = 'island-test-3';
    (Hello as any).__HS_ISLAND = {
      id: jsId,
      render: (props: any, options: any = {}) =>
        buildIslandHtml(jsId, 'Hello', 'hello', '', renderPreactSSR(Hello, props), options),
    };

    const result = renderPreactIsland(Hello, { name: 'Bob' });
    expect(result.content).toContain(`<div id="${jsId}">`);
  });

  test('island output contains a hydration script tag', () => {
    const jsId = 'island-test-4';
    (Hello as any).__HS_ISLAND = {
      id: jsId,
      render: (props: any, options: any = {}) => {
        const ssrContent = renderPreactSSR(Hello, props);
        const jsContent = `import { h as __hs_h, hydrate as __hs_hydrate } from 'preact';__hs_hydrate(__hs_h(Hello, ${JSON.stringify(props)}), document.getElementById("${jsId}"));`;
        return buildIslandHtml(jsId, 'Hello', 'hello', jsContent, ssrContent, options);
      },
    };

    const result = renderPreactIsland(Hello, { name: 'World' });
    expect(result.content).toContain('<script type="module"');
    expect(result.content).toContain('hydrate');
  });

  test('ssr: false produces no SSR content', () => {
    const jsId = 'island-test-5';
    (Hello as any).__HS_ISLAND = {
      id: jsId,
      render: (props: any, options: any = {}) => {
        if (options.ssr === false) {
          return buildIslandHtml(jsId, 'Hello', 'hello', 'console.log("mount")', '', options);
        }
        return buildIslandHtml(jsId, 'Hello', 'hello', '', renderPreactSSR(Hello, props), options);
      },
    };

    const result = renderPreactIsland(Hello, { name: 'World' }, { ssr: false, loading: undefined });
    expect(result.content).not.toContain('Hello World!');
    expect(result.content).toContain(`<div id="${jsId}"></div>`);
  });

  test('loading: lazy wraps the script in a template', () => {
    const jsId = 'island-test-6';
    (Hello as any).__HS_ISLAND = {
      id: jsId,
      render: (props: any, options: any = {}) =>
        buildIslandHtml(jsId, 'Hello', 'hello', 'console.log(1)', renderPreactSSR(Hello, props), options),
    };

    const result = renderPreactIsland(Hello, { name: 'World' }, { ssr: true, loading: 'lazy' } as any);
    expect(result.content).toContain('data-loading="lazy"');
    expect(result.content).toContain('<template>');
    expect(result.content).toContain('Hello World!');
  });
});
