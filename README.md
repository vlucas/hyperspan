# Hyperspan

Hyperspan is a modern server-oriented TypeScript framework for building web sites and applications. Hyperspan is
positioned somewhere between a more traditional server-side framework like Express and a newer frontend framework like
Next.js. Hyperspan keeps most of the work and state on the server, but also supports using embedded React and Preact
components with dynamic islands to add rich client-side interactivity to your application right where you need it, while
shipping minimal JavaScript to the client.

Visit: [Hyperspan.dev](https://www.hyperspan.dev)

## Deployment adapters

Pass a deployment adapter to `deployAdapter`. Island plugins go in `plugins`. Omit `deployAdapter` to deploy to Node.

```ts
import { createConfig } from '@hyperspan/framework';
import { cloudflareAdapter } from '@hyperspan/adapter-cloudflare';
import { preactPlugin } from '@hyperspan/plugin-preact';

export default createConfig({
  deployAdapter: cloudflareAdapter(),
  plugins: [preactPlugin()],
});
```

```ts
export default createConfig({
  plugins: [preactPlugin()],
  // deployAdapter omitted → Node
});
```

`hyperspan build` generates `dist/server.ts` from the adapter’s `createEntry()`.

| Adapter | `deployAdapter` | Entry |
|---------|-----------------|-------|
| `@hyperspan/adapter-node` (default) | omit, or `nodeAdapter()` | `start()` |
| `@hyperspan/adapter-bun` | `bunAdapter()` | `start()` |
| `@hyperspan/adapter-cloudflare` | `cloudflareAdapter()` | `fetch()` |

Use `beforeServerCreate({ env })` to wire platform bindings. On Node/Bun, `env` is `process.env`. On Cloudflare, `cloudflareAdapter()` loads Wrangler bindings during `hyperspan dev` and the Worker `env` in production.

For Cloudflare, `cloudflareAdapter()` also syncs Wrangler CSS aliases after `hyperspan build`.

## Packages in this repo

- `@hyperspan/html` - Streaming HTML templates, useable in any project
- `@hyperspan/framework` - Hyperspan web framework for sites and apps
- `@hyperspan/plugin-preact` - Preact Islands plugin for Hyperspan
- `@hyperspan/plugin-svelte` - Svelte 5 Islands plugin for Hyperspan
- `@hyperspan/plugin-vue` - Vue 3 Islands plugin for Hyperspan
- `@hyperspan/starter-template` - Hyperspan starter template references in docs
