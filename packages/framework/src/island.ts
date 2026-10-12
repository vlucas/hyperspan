import { html } from './html';

type IslandComponent = {
  __HS_ISLAND?: {
    render: (props: unknown, options: unknown) => string | Promise<string>;
  };
  name?: string;
};

export type IslandRenderOptions = {
  ssr?: boolean;
  loading?: 'lazy' | undefined;
};

/**
 * Render any Hyperspan island component (Preact, Svelte, Vue).
 * Proxies to `Component.__HS_ISLAND.render` injected by the island Vite plugin.
 */
export function renderIsland(
  Component: IslandComponent,
  props: Record<string, unknown> = {},
  options: IslandRenderOptions = { ssr: true }
) {
  if (!Component?.__HS_ISLAND?.render) {
    const label = Component?.name ?? 'Component';
    throw new Error(
      `${label} is not a Hyperspan island. Import it with \`with { island: 'preact' | 'svelte' | 'vue' }\` ` +
        `and ensure the matching plugin is listed in hyperspan.config.ts plugins.`
    );
  }

  const result = Component.__HS_ISLAND.render(props, options);
  if (result != null && typeof (result as Promise<string>).then === 'function') {
    return (result as Promise<string>).then((s) => html.raw(s));
  }
  return html.raw(result as string);
}
