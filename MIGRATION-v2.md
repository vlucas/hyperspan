# Hyperspan v2 Migration Guide

Hyperspan v2 replaces Bun as the required runtime with a **Vite build pipeline** and **portable `fetch(Request) → Response` handlers** deployable to Node, Cloudflare Workers, Bun, and other platforms.

## Breaking changes

### Runtime

- **Bun is no longer required.** Node 24+ is the default runtime.
- Install dependencies with `npm install` (or pnpm/yarn). Bun still works as an optional runtime via `@hyperspan/adapter-bun`.
- CLI shebangs use Node (`#!/usr/bin/env node`).

### Build pipeline

- **Vite owns dev, build, CSS, client JS, and islands.** `Bun.build` and `Bun.plugin` are removed.
- Add `vite.config.ts` to your project (see starter template).
- Production requires an explicit build: `npm run build` before `npm run start`.
- Assets emit to `dist/` (including `dist/manifest.json`).

### Island plugins

Island plugins now export **Vite plugins** in addition to Hyperspan config plugins:

```ts
// vite.config.ts
import { preactVitePlugin } from '@hyperspan/plugin-preact';
import { svelteVitePlugin } from '@hyperspan/plugin-svelte';
import { vueVitePlugin } from '@hyperspan/plugin-vue';
```

`hyperspan.config.ts` plugins remain for config hooks but no longer register Bun loaders.

### Scripts

| v1 | v2 |
|----|-----|
| `bun run dev` | `npm run dev` → `hyperspan dev` (Vite) |
| `hyperspan start` (Bun) | `hyperspan start` (Node via `@hyperspan/adapter-node`) |
| — | `hyperspan build` (production bundle) |

### Asset hashing

- `assetHash()` now uses FNV-1a (portable) instead of MD5. Action URLs at `/__actions/<hash>` will change.

### New packages

| Package | Purpose |
|---------|---------|
| `@hyperspan/vite-plugin` | Vite integration, route loading, manifest |
| `@hyperspan/adapter-node` | Node.js HTTP server (default) |
| `@hyperspan/adapter-cloudflare` | Cloudflare Workers |
| `@hyperspan/adapter-bun` | Optional Bun runtime |

### API additions

```ts
import { createFetchHandler, createApp, setAssetManifest } from '@hyperspan/framework';
```

- `createFetchHandler(server)` — portable request router
- `createApp(server)` — `{ fetch, server }` adapter contract
- `setAssetManifest(manifest)` — register build-time asset URLs

## Migration steps

1. **Install v2 alpha packages** — use the `alpha` dist-tag:
   ```bash
   npm install hyperspan@alpha @hyperspan/framework@alpha @hyperspan/vite-plugin@alpha
   ```
   Or pin a specific pre-release: `^2.0.0-alpha.1`
2. **Upgrade packages** to v2 alpha.
3. **Add `vite.config.ts`** (copy from starter template).
3. **Update `package.json` scripts** to use `npm run dev/build/start`.
4. **Remove Bun-only dependencies** (`bun-plugin-tailwind`, `bun:sqlite` in app code).
5. **Run `npm run build`** before deploying.
6. **Update Docker** to `node:24` base image.

## Cloudflare Workers

```ts
import { createCloudflareHandler } from '@hyperspan/adapter-cloudflare';
import server from './dist/server';

export default createCloudflareHandler(server, {
  assets: env.ASSETS,
});
```

## What stays the same

- File-based `app/routes` and `app/actions`
- `createRoute()`, `createAction()`, `html` templates, layouts
- Streaming HTML and island component APIs
- `hyperspanScriptTags()` / `hyperspanStyleTags()`

## SSG

`hyperspan build:ssg` remains unimplemented in v2 but is easier to add now that routes compile to a manifest at build time.
