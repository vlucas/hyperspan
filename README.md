# Hyperspan

Hyperspan is a modern server-oriented TypeScript framework for building web sites and applications. Hyperspan is
positioned somewhere between a more traditional server-side framework like Express and a newer frontend framework like
Next.js. Hyperspan keeps most of the work and state on the server, but also supports using embedded React and Preact
components with dynamic islands to add rich client-side interactivity to your application right where you need it, while
shipping minimal JavaScript to the client.

Visit: [Hyperspan.dev](https://www.hyperspan.dev)

## Deploy targets

`hyperspan build` generates `dist/server.ts` with the adapter for your `deployTarget` (default `'node'`):

| Target | Generated entry | Adapter |
|--------|-----------------|---------|
| `node` | `export async function start()` | `@hyperspan/adapter-node` |
| `bun` | `export async function start()` | `@hyperspan/adapter-bun` |
| `cloudflare` | `export default { fetch }` | `@hyperspan/adapter-cloudflare` |

Use `beforeServerCreate({ env })` in `hyperspan.config.ts` to wire platform bindings before the server is created. On Node/Bun, `env` is `process.env`; on Cloudflare Workers, `env` is the bindings object.

For Cloudflare, `hyperspan build` auto-syncs Wrangler CSS aliases (layout CSS imports are build-time only; styles ship via `dist/assets/`).

## Packages in this repo

- `@hyperspan/html` - Streaming HTML templates, useable in any project
- `@hyperspan/framework` - Hyperspan web framework for sites and apps
- `@hyperspan/plugin-preact` - Preact Islands plugin for Hyperspan
- `@hyperspan/plugin-svelte` - Svelte 5 Islands plugin for Hyperspan
- `@hyperspan/plugin-vue` - Vue 3 Islands plugin for Hyperspan
- `@hyperspan/starter-template` - Hyperspan starter template references in docs
