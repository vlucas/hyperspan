import { test, describe, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { buildIslandHtml, renderSvelteSSR, renderSvelteIsland } from './index';

// ---------------------------------------------------------------------------
// Compile the Hello.svelte fixture into a temp .mjs file for SSR testing.
// Svelte components must be compiled before they can be rendered server-side.
// ---------------------------------------------------------------------------

let HelloComponent: any;
const tmpPath = join(import.meta.dir, '__fixtures__/__hello_ssr_temp__.mjs');

beforeAll(async () => {
  const { compile } = await import('svelte/compiler');
  const source = await Bun.file(join(import.meta.dir, '__fixtures__/Hello.svelte')).text();

  const { js } = compile(source, {
    filename: 'Hello.svelte',
    generate: 'server',
  });

  writeFileSync(tmpPath, js.code);
  const mod = await import(tmpPath);
  HelloComponent = mod.default;
});

afterAll(() => {
  try {
    unlinkSync(tmpPath);
  } catch {
    // already gone
  }
});

// ---------------------------------------------------------------------------
// buildIslandHtml
// ---------------------------------------------------------------------------

describe('buildIslandHtml', () => {
  const jsId = 'svelte-abc123';
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
// renderSvelteSSR
// ---------------------------------------------------------------------------

describe('renderSvelteSSR', () => {
  test('renders a component to an HTML string', async () => {
    const output = await renderSvelteSSR(HelloComponent, { name: 'World' });
    expect(output).toContain('<div');
    expect(output).toContain('Hello World!');
  });

  test('passes props to the component', async () => {
    const output = await renderSvelteSSR(HelloComponent, { name: 'Alice', count: 42 });
    expect(output).toContain('Hello Alice!');
    expect(output).toContain('42');
  });

  test('uses component defaults when props are omitted', async () => {
    const output = await renderSvelteSSR(HelloComponent, {});
    expect(output).toContain('Hello World!');
    expect(output).toContain('0');
  });

  test('returns a string', async () => {
    const output = await renderSvelteSSR(HelloComponent, {});
    expect(typeof output).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// renderSvelteIsland
// ---------------------------------------------------------------------------

describe('renderSvelteIsland', () => {
  test('throws when component has no __HS_ISLAND property', () => {
    function Bare() {}
    expect(() => renderSvelteIsland(Bare, {})).toThrow('was not loaded with an island plugin');
  });

  test('returns an html_safe object', async () => {
    const jsId = 'svelte-island-1';
    const mockComponent: any = function MockHello() {};
    mockComponent.__HS_ISLAND = {
      id: jsId,
      render: async (props: any, options: any = {}) => {
        const ssrContent = await renderSvelteSSR(HelloComponent, props);
        return buildIslandHtml(jsId, 'Hello', 'hello-svelte', '', ssrContent, options);
      },
    };

    // renderSvelteIsland is sync but render() is async, so content is a Promise
    const result = renderSvelteIsland(mockComponent, { name: 'World' });
    expect(result).toHaveProperty('_kind', 'html_safe');
    const content = await result.content;
    expect(typeof content).toBe('string');
  });

  test('island output contains SSR-rendered HTML', async () => {
    const jsId = 'svelte-island-2';
    const mockComponent: any = function MockHello() {};
    mockComponent.__HS_ISLAND = {
      id: jsId,
      render: async (props: any, options: any = {}) => {
        const ssrContent = await renderSvelteSSR(HelloComponent, props);
        return buildIslandHtml(jsId, 'Hello', 'hello-svelte', '', ssrContent, options);
      },
    };

    const raw = renderSvelteIsland(mockComponent, { name: 'Svelte', count: 5 });
    const content = await raw.content;
    expect(content).toContain('Hello Svelte!');
    expect(content).toContain('5');
  });

  test('island output contains the wrapper div with the correct id', async () => {
    const jsId = 'svelte-island-3';
    const mockComponent: any = function MockHello() {};
    mockComponent.__HS_ISLAND = {
      id: jsId,
      render: async (props: any, options: any = {}) => {
        const ssrContent = await renderSvelteSSR(HelloComponent, props);
        return buildIslandHtml(jsId, 'Hello', 'hello-svelte', '', ssrContent, options);
      },
    };

    const raw = renderSvelteIsland(mockComponent, { name: 'World' });
    const content = await raw.content;
    expect(content).toContain(`<div id="${jsId}">`);
  });

  test('island output contains a hydration script tag', async () => {
    const jsId = 'svelte-island-4';
    const esmName = 'hello-svelte';
    const mockComponent: any = function MockHello() {};
    mockComponent.__HS_ISLAND = {
      id: jsId,
      render: async (props: any, options: any = {}) => {
        const ssrContent = await renderSvelteSSR(HelloComponent, props);
        const jsContent = `import { hydrate as __hs_hydrate } from 'svelte';__hs_hydrate(Hello, { target: document.getElementById("${jsId}"), props: ${JSON.stringify(props)} });`;
        return buildIslandHtml(jsId, 'Hello', esmName, jsContent, ssrContent, options);
      },
    };

    const raw = renderSvelteIsland(mockComponent, { name: 'World' });
    const content = await raw.content;
    expect(content).toContain('<script type="module"');
    expect(content).toContain('hydrate');
  });

  test('loading: lazy wraps the script in a template', async () => {
    const jsId = 'svelte-island-5';
    const mockComponent: any = function MockHello() {};
    mockComponent.__HS_ISLAND = {
      id: jsId,
      render: async (props: any, options: any = {}) => {
        const ssrContent = await renderSvelteSSR(HelloComponent, props);
        return buildIslandHtml(jsId, 'Hello', 'hello-svelte', 'console.log(1)', ssrContent, options);
      },
    };

    const raw = renderSvelteIsland(mockComponent, { name: 'World' }, { ssr: true, loading: 'lazy' } as any);
    const content = await raw.content;
    expect(content).toContain('data-loading="lazy"');
    expect(content).toContain('<template>');
    expect(content).toContain('Hello World!');
  });
});
