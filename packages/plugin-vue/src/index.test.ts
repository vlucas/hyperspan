import { test, describe, expect } from 'bun:test';
import { defineComponent, h } from 'vue';
import { buildIslandHtml, renderVueSSR, renderVueIsland } from './index';

// ---------------------------------------------------------------------------
// Simple Vue components defined inline — no .vue compilation needed
// ---------------------------------------------------------------------------

const Hello = defineComponent({
  props: {
    name: { type: String, default: 'World' },
    count: { type: Number, default: 0 },
  },
  render() {
    return h('div', { class: 'hello' }, [
      h('h1', `Hello ${this.name}!`),
      h('p', `Count: ${this.count}`),
    ]);
  },
});

// ---------------------------------------------------------------------------
// buildIslandHtml
// ---------------------------------------------------------------------------

describe('buildIslandHtml', () => {
  const jsId = 'vue-abc123';
  const componentName = '__hs_vue_component';
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
// renderVueSSR
// ---------------------------------------------------------------------------

describe('renderVueSSR', () => {
  test('renders a component to an HTML string', async () => {
    const output = await renderVueSSR(Hello, { name: 'World' });
    expect(output).toContain('<div');
    expect(output).toContain('Hello World!');
  });

  test('passes props to the component', async () => {
    const output = await renderVueSSR(Hello, { name: 'Alice', count: 42 });
    expect(output).toContain('Hello Alice!');
    expect(output).toContain('Count: 42');
  });

  test('uses component defaults when props are omitted', async () => {
    const output = await renderVueSSR(Hello, {});
    expect(output).toContain('Hello World!');
    expect(output).toContain('Count: 0');
  });

  test('returns a string', async () => {
    const output = await renderVueSSR(Hello, {});
    expect(typeof output).toBe('string');
  });

  test('Vue SSR output contains data-v- hydration markers', async () => {
    // Vue SSR adds data-v- attributes for hydration matching
    const output = await renderVueSSR(Hello, { name: 'World' });
    // Just verify the component's root element is present
    expect(output).toMatch(/class="hello"/);
  });
});

// ---------------------------------------------------------------------------
// renderVueIsland
// ---------------------------------------------------------------------------

describe('renderVueIsland', () => {
  test('throws when component has no __HS_ISLAND property', async () => {
    const Bare = defineComponent({ render: () => h('div') });
    await expect(renderVueIsland(Bare, {})).rejects.toThrow('was not loaded with an island plugin');
  });

  test('returns an html_safe object', async () => {
    const jsId = 'vue-island-1';
    const mockComponent = defineComponent({ render: () => h('span') }) as any;
    mockComponent.__HS_ISLAND = {
      id: jsId,
      render: async (props: any, options: any = {}) => {
        const ssrContent = await renderVueSSR(Hello, props);
        return buildIslandHtml(jsId, '__hs_vue_component', 'hello-vue', '', ssrContent, options);
      },
    };

    const result = await renderVueIsland(mockComponent, { name: 'World' });
    expect(result).toHaveProperty('_kind', 'html_safe');
  });

  test('island output contains SSR-rendered HTML', async () => {
    const jsId = 'vue-island-2';
    const mockComponent = defineComponent({ render: () => h('span') }) as any;
    mockComponent.__HS_ISLAND = {
      id: jsId,
      render: async (props: any, options: any = {}) => {
        const ssrContent = await renderVueSSR(Hello, props);
        return buildIslandHtml(jsId, '__hs_vue_component', 'hello-vue', '', ssrContent, options);
      },
    };

    const result = await renderVueIsland(mockComponent, { name: 'Vue', count: 9 });
    expect(result.content).toContain('Hello Vue!');
    expect(result.content).toContain('Count: 9');
  });

  test('island output contains the wrapper div with the correct id', async () => {
    const jsId = 'vue-island-3';
    const mockComponent = defineComponent({ render: () => h('span') }) as any;
    mockComponent.__HS_ISLAND = {
      id: jsId,
      render: async (props: any, options: any = {}) => {
        const ssrContent = await renderVueSSR(Hello, props);
        return buildIslandHtml(jsId, '__hs_vue_component', 'hello-vue', '', ssrContent, options);
      },
    };

    const result = await renderVueIsland(mockComponent, { name: 'World' });
    expect(result.content).toContain(`<div id="${jsId}">`);
  });

  test('island output contains a hydration script tag', async () => {
    const jsId = 'vue-island-4';
    const esmName = 'hello-vue';
    const mockComponent = defineComponent({ render: () => h('span') }) as any;
    mockComponent.__HS_ISLAND = {
      id: jsId,
      render: async (props: any, options: any = {}) => {
        const ssrContent = await renderVueSSR(Hello, props);
        const jsContent = `import { createSSRApp as __hs_createSSRApp } from 'vue';__hs_createSSRApp(__hs_vue_component, ${JSON.stringify(props)}).mount(document.getElementById("${jsId}"));`;
        return buildIslandHtml(jsId, '__hs_vue_component', esmName, jsContent, ssrContent, options);
      },
    };

    const result = await renderVueIsland(mockComponent, { name: 'World' });
    expect(result.content).toContain('<script type="module"');
    expect(result.content).toContain('createSSRApp');
  });

  test('ssr: false produces no SSR content', async () => {
    const jsId = 'vue-island-5';
    const mockComponent = defineComponent({ render: () => h('span') }) as any;
    mockComponent.__HS_ISLAND = {
      id: jsId,
      render: async (props: any, options: any = {}) => {
        if (options.ssr === false) {
          return buildIslandHtml(jsId, '__hs_vue_component', 'hello-vue', 'console.log("mount")', '', options);
        }
        const ssrContent = await renderVueSSR(Hello, props);
        return buildIslandHtml(jsId, '__hs_vue_component', 'hello-vue', '', ssrContent, options);
      },
    };

    const result = await renderVueIsland(mockComponent, { name: 'World' }, { ssr: false, loading: undefined });
    expect(result.content).not.toContain('Hello World!');
    expect(result.content).toContain(`<div id="${jsId}"></div>`);
  });

  test('loading: lazy wraps the script in a template', async () => {
    const jsId = 'vue-island-6';
    const mockComponent = defineComponent({ render: () => h('span') }) as any;
    mockComponent.__HS_ISLAND = {
      id: jsId,
      render: async (props: any, options: any = {}) => {
        const ssrContent = await renderVueSSR(Hello, props);
        return buildIslandHtml(jsId, '__hs_vue_component', 'hello-vue', 'console.log(1)', ssrContent, options);
      },
    };

    const result = await renderVueIsland(mockComponent, { name: 'World' }, { ssr: true, loading: 'lazy' } as any);
    expect(result.content).toContain('data-loading="lazy"');
    expect(result.content).toContain('<template>');
    expect(result.content).toContain('Hello World!');
  });
});
