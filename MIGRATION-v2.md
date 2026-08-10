# Hyperspan v2

Hyperspan v2 uses a **Vite build pipeline** and **portable `fetch(Request) → Response` handlers** deployable to Node, Cloudflare Workers, Bun, and other platforms.

## Runtime

- **Node 24+** is the default runtime.
- Install dependencies with `npm install` (or pnpm/yarn). Bun works as an optional runtime via `@hyperspan/adapter-bun`.
- CLI shebangs use Node (`#!/usr/bin/env node`).

## Build pipeline

- **Vite** handles dev, build, CSS, client JS, and islands.
- Add `vite.config.ts` to your project (see starter template).
- Run `npm run build` before `npm run start` in production.
- Assets emit to `dist/` (including `dist/manifest.json`).

## Island plugins

Configure island plugins in `hyperspan.config.ts`. The Vite integration loads that config automatically:

```ts
// hyperspan.config.ts
import { createConfig } from '@hyperspan/framework';
import { preactPlugin } from '@hyperspan/plugin-preact';
import { sveltePlugin } from '@hyperspan/plugin-svelte';
import { vuePlugin } from '@hyperspan/plugin-vue';

export default createConfig({
  plugins: [preactPlugin(), sveltePlugin(), vuePlugin()],
});
```

```ts
// vite.config.ts
import { hyperspan } from '@hyperspan/vite-plugin';

export default defineConfig({
  plugins: [...hyperspan()],
});
```

`hyperspan.config.ts` plugins register island frameworks and run config hooks.

Mark a component as an island at import time:

```ts
import { renderIsland } from '@hyperspan/framework';
import Counter from '../widgets/counter.tsx' with { island: 'preact' };

html`${renderIsland(Counter, { count: 0 })}`;
```

Use `with { island: 'svelte' }` or `with { island: 'vue' }` for other frameworks. Preact supports named exports in the same file. `renderPreactIsland`, `renderSvelteIsland`, and `renderVueIsland` are aliases for `renderIsland`.

## Custom client JS

Register arbitrary client modules by path. The server never evaluates client-only code — Vite bundles it and the manifest records the public URL.

```ts
import { buildClientJS } from '@hyperspan/framework/client/js';

const picker = await buildClientJS(import.meta.resolve('./app/client/picker.ts'));

html`
  <div id="picker"></div>
  ${picker.renderScriptTag(({ mountPicker }) => mountPicker())}
`;
```

`renderScriptTag()` with no argument emits a module script that imports the bundle via the import map. Pass a function or string to inline bootstrap code that receives the module exports.

## Scripts

| Command | What it does |
|---------|----------------|
| `npm run dev` | `hyperspan dev` — Vite dev server |
| `npm run build` | `hyperspan build` — production bundle |
| `npm run start` | `hyperspan start` — Node via `@hyperspan/adapter-node` |

## Asset hashing

`assetHash()` uses FNV-1a. Action URLs live at `/__actions/<hash>`.

## Packages

| Package | Purpose |
|---------|---------|
| `@hyperspan/vite-plugin` | Vite integration, route loading, manifest |
| `@hyperspan/adapter-node` | Node.js HTTP server (default) |
| `@hyperspan/adapter-cloudflare` | Cloudflare Workers |
| `@hyperspan/adapter-bun` | Optional Bun runtime |

## Framework API

```ts
import { createFetchHandler, createApp, setAssetManifest } from '@hyperspan/framework';
```

- `createFetchHandler(server)` — portable request router
- `createApp(server)` — `{ fetch, server }` adapter contract
- `setAssetManifest(manifest)` — register build-time asset URLs
- `renderIsland(component, props)` — render any island (proxies `__HS_ISLAND`)

## Setup

1. **Install v2 alpha packages** — use the `alpha` dist-tag:
   ```bash
   npm install hyperspan@alpha @hyperspan/framework@alpha @hyperspan/vite-plugin@alpha
   ```
   Or pin a specific pre-release: `^2.0.0-alpha.2`
2. **Add `vite.config.ts`** (copy from starter template).
3. **Update `package.json` scripts** to use `npm run dev/build/start`.
4. **Run `npm run build`** before deploying.
5. **Use a `node:24` base image** in Docker.

## Cloudflare Workers

```ts
import { createCloudflareHandler } from '@hyperspan/adapter-cloudflare';
import server from './dist/server';

export default createCloudflareHandler(server, {
  assets: env.ASSETS,
});
```

## Application structure

- File-based `app/routes` and `app/actions`
- `createRoute()`, `createAction()`, `html` templates, layouts
- Streaming HTML and island component APIs
- `hyperspanScriptTags()` / `hyperspanStyleTags()`

## SSG

`hyperspan build:ssg` is not implemented yet. Routes compile to a manifest at build time, which makes SSG straightforward to add later.
